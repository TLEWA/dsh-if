# dsh-if

[![CI](https://github.com/TLEWA/dsh-if/actions/workflows/ci.yml/badge.svg)](https://github.com/TLEWA/dsh-if/actions/workflows/ci.yml)
[![Release](https://github.com/TLEWA/dsh-if/actions/workflows/release.yml/badge.svg)](https://github.com/TLEWA/dsh-if/releases)
[![npm version](https://img.shields.io/npm/v/dsh-if.svg)](https://www.npmjs.com/package/dsh-if)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

[简体中文](README.md) · [English](README.en.md)

给 [DeepSeek Harness](https://github.com/deepseek-ai)（DSH）加一个自定义 `/if` 命令：

> 先判断条件是否成立：判断器是一个 **fork 子代理**，继承当前会话的工具、system prompt 与消息历史，
> 只在末尾追加一条判断指令；成立时，把下方的指令作为一条普通用户消息发给主 agent；不成立时什么都不做。

判断请求与主会话的下一次请求共享同一个前缀（tools → system → messages 逐字节一致），
因此能复用 provider 的 prompt cache / KV cache。`/if` 命令、条件、判断用的 prompt 和判断结果
**都不会写进主会话**；条件成立时，主会话只在历史末尾多一条普通用户消息，不会改写已有前缀。

## 功能

| 能力 | 行为 |
| --- | --- |
| 上下文条件判断 | 判断器继承当前会话的完整上下文（工具 + system prompt + 历史消息），按条件回答 `YES` 或 `NO` |
| 复用 KV 缓存 | fork 子代理只追加一条尾部 user 消息，tools / system / messages 与主会话逐字节一致，命中 provider 前缀缓存 |
| 只读判断 | 工具目录保持不变（这正是缓存命中的前提），执行期 guard 只放行 `read` / `glob` / `grep` 等只读工具；写入、命令、子代理一律拒绝 |
| 忙碌时排队 | 模型正在工作时，`/if` 立即返回、不占用输入框，再等到当前回合结束才判断，不会拿旧上下文下结论 |
| 条件成立才发送 | 只有 `YES` 才把指令作为用户消息发给主 agent，`NO` 完全不触发主 agent |
| 判断不进上下文 | 判断在独立子会话里完成，不写主会话事件，不调用 `agent.inject` |
| 命令不泄露参数 | `recordInput: false`，log-only 的 `command/run` 也不记录条件或指令 |
| 多行条件 | 第一行是条件，其余行是指令；条件有多行时用单独一行 `---` 分隔 |
| 自动回退 | host 没有可继承上下文的 fork provider 时，回退到一次性 `ctx.llm.stream` + 约 24k 字符纯文本记录 |
| 防止误发 | 条件为空、指令为空、判断输出不是 `YES` / `NO`、或判断超时，都返回错误且不发送 |

## 安装

要求：

- DSH `0.2.1-rc.5` 或更新版本；
- Node.js `20.3` 或更新版本（使用 `AbortSignal.any` / `AbortSignal.timeout`）。

### 从 npm 安装（推荐）

1. 打开侧边栏 **插件** 页 → **安装插件**；
2. 输入包名并确认：

   ```text
   dsh-if
   ```

3. 安装完成后重启 DSH（host 插件在 profile 启动时加载）。

固定版本：

```text
dsh-if@0.2.4
```

命令行等价写法：

```powershell
dsh plugin --profile desktop add dsh-if@0.2.4
```

### 从 GitHub 安装

`lib/` 是可直接运行的源码，不需要本地构建：

```text
https://github.com/TLEWA/dsh-if
```

固定到标签或 Release 附件：

```powershell
dsh plugin --profile desktop add github:TLEWA/dsh-if#v0.2.4
```

```text
https://github.com/TLEWA/dsh-if/releases/download/v0.2.4/dsh-if-0.2.4.tgz
```

### 从源码安装

```powershell
git clone https://github.com/TLEWA/dsh-if.git
cd dsh-if
npm test
dsh plugin --profile desktop add .
```

重启 DSH 后，在输入框输入 `/if`，斜杠面板会出现命令。

## 用法

基本形式：第一行是条件，其余行是指令。

```text
/if 1+1=2
请只回复 OK
```

条件本身有多行时，用单独一行 `---` 分隔条件和指令：

```text
/if 用户已经确认方案 A
并且测试已经通过
---
请开始执行方案 A
```

也可以只写一行条件和一个单行指令；`/if` 后面的第一个换行就是分隔点。

### 判断语义

- 判断由当前会话配置的模型完成，不是 JavaScript 或数学求值器。
  `1+1=2` 只是最小示例；条件可以是“用户是否已经确认方案”“上一条回复是否包含错误”等。
- 判断器只被要求输出 `YES` 或 `NO`。输出里没有可识别结果时按判断失败处理，不发送指令。
- 判断器可以只读地查看文件、检索代码来确认事实（`read` / `glob` / `grep` 等），但不能做任何修改。
- 条件需要的信息在当前上下文里找不到、或者条件含糊无法确定时，判为不成立：宁可不动，也不误发指令。
- UI 只显示通用结果，不回显条件、指令或判断原文。

## 工作方式

1. `ctx.commands.register` 注册 `/if`，并设置 `recordInput: false`。
2. **排队到当前回合结束。** 斜杠命令在模型工作时也会被立即派发，但此时 fork 子会话只能继承到上一个
   `turn/end` 之前的历史，看到的是"正在进行的工作还没发生"的旧上下文。所以 `/if` 先读
   `session.snapshotEvents()`：只要有未闭合的回合，就把判断交给后台任务（命令立刻返回"已排队"，
   输入框不被占用），等那个回合结束（最多 30 分钟）再判断。判断和投递用的都是回合结束后的完整上下文，
   所以下一个回合开始时，指令和普通消息一样排在队列里等待。
3. **首选：fork 子代理判断。** 通过 `ctx.subagents.getProvider('fork')` 取 provider（要求
   `inheritsParentContext === true`），再用 `startActivation({ provider: 'fork', childId, request: { parent, agentOptions, prompt }, delivery: 'caller' })`
   启动判断子会话。请求里只有一条尾部 user 消息（判断规则 + 条件）；tools、system prompt、历史消息全部原样继承，
   前缀与主会话下一次请求逐字节一致。
4. **执行期只读限制。** 子会话继承完整工具目录，但 `ctx.tools.guard` 注册的 guard 只对判断子会话生效：
   `read` / `glob` / `grep` / `web_search` / `web_fetch` / `skill` 等只读工具放行，
   写入、修改、执行命令、子代理等一律返回拒绝文案。工具目录不裁剪，所以缓存前缀不变。
5. 判断超时 60 秒；只有 `YES` 时调用 `agent.followup(...)`，把指令作为一条带 `id` 和 `role: 'user'` 的已识别消息
   追加到主会话；`NO` 时完全不触发主 agent。
6. **回退路径。** host 没有可继承上下文的 fork provider 时，`historyTranscript()` 读取
   `agent.session.deriveMessages()`，只保留 user / assistant / tool 消息，生成最多约 24k 字符的纯文本记录
   （每条消息最多 3k 字符，保留头尾），再用 `ctx.llm.stream()` 发起一次性判断请求。
   该请求不带主会话 `sessionId`，因此命中不了主缓存，只作为兼容退路。

## KV 缓存与上下文隔离

这是设计约束，不是可选项：

- `/if` 命令、条件、指令、判断 prompt、判断结果都不写入主会话；
  `command/run` 和 `command/done` 是 log-only 事件，不进入模型请求。
- 判断在 **fork 子代理**里完成：tools、system prompt、历史消息全部继承，只在末尾追加一条 user 消息。
  因此判断请求的前缀与主会话下一次请求逐字节一致，provider 的 prefix cache / KV cache 可以直接复用，
  不会因为一次判断而让整段上下文重新计费。
- 判断子会话是独立会话，不追加主会话的 session 事件，只读历史；工具目录也不裁剪
  （裁剪工具定义会改变前缀，反而破坏缓存），只读限制放在执行期 guard。
- 代价是透明可见的：每次判断都会把整段上下文重发一次，token 计数按全量算，命中缓存的部分
  按 provider 的缓存价计费。会话越长，单次判断的绝对 token 数越大（缓存命中率决定实际花费）。
- 条件不成立（`NO`）时，主会话没有任何变化。
- 条件成立（`YES`）时，唯一的改动是通过 `agent.followup` 在历史**末尾追加**一条普通用户消息。
  之前的消息、system prompt、工具声明都不变，因此主请求的可复用前缀保持字节一致，
  provider 的 prefix cache / KV cache 不会被这次命令改写。
- 插件不会调用 `agent.inject` 把判断结果塞进上下文，也不会编辑、替换或删除已有 session 事件。

## 兼容性

- 已在 DSH `0.2.1-rc.5`、Windows 桌面端验证；
- 命令使用 `@deepseek-ai/dsh-commands` 的公开注册接口；
- 判断优先使用 `ctx.subagents` 的 `fork` provider + `ctx.tools.guard`；host 不提供时自动回退到 `ctx.llm.stream`；
- 不依赖客户端 bundle，不需要构建步骤。

## 测试

```powershell
npm test
```

测试使用 mock 的 `ctx.commands`、`ctx.llm`、`ctx.subagents`、`ctx.tools` 和 `agent`，覆盖：

- 注册信息与 `recordInput: false`
- fork 判断只追加一条尾部消息、`agentOptions.maxTokens` 收敛、子会话被释放
- `YES` 只发送指令、`NO` 不发送
- 判断输出里的 tool-call 标记会被剥离，`MAYBE` 之类的输出按失败处理
- guard 只拦判断子会话：`write` / `pwsh` 被拒，`read` / `grep` 放行，其它会话不受影响，判断结束即释放归属
- 没有可继承上下文的 fork provider 时回退到 transcript 判断，且绝不复用不继承前缀的 provider
- fork 启动失败时返回判断错误且不发送指令
- `---` 多行条件
- 缺少指令 / 空指令
- 过滤 system / developer 消息
- 不支持 `reasoningEffort` 时的重试
- 判断 prompt 不含指令，结果文本不含条件或判断原文
- 发送的指令消息带 `id` 和 `role: 'user'`，持久化 session 可以正常重载

## 隐私

- 插件不含遥测、统计上报或第三方远程请求。
- 判断时会把“当前会话已有上下文 + 条件”发送给当前会话配置的模型提供商，与正常对话走同一条模型通道。
- 条件和上下文可能包含敏感信息；不要把不希望发送给模型提供商的内容写进 `/if` 条件。

## 已知限制

- 判断在宿主里是一个真实的子代理回合：桌面端会在会话时间线上显示一张子代理卡片
  （label 为 `if judge`，含耗时、费用与 token 用量），判断结束即释放。主会话的消息列表
  不会因此多出任何 judge 消息——那张卡片属于独立子会话。
- `/if` 排队时不会出现在输入框上方的"排队消息"面板里：那是客户端的本地发件箱，斜杠命令会被立即派发，
  插件没有办法往里塞条目，所以也不能在那里面编辑、删除或"强制推送"。命令节点自己会显示"已排队"。
- 只读白名单是静态名单：未列出的工具（包括 MCP 只读工具）会被拒绝；需要放宽时请提 issue。
- 回退路径（host 没有 fork provider）看到的是纯文本记录，图片和文件只显示 `[图片]` / `[文件]` 占位符，
  条件需要的信息如果不在最近约 24k 字符的记录里，会被判为不成立。
- 判断使用当前会话的 provider/model；当前会话没有可用路由时返回错误。
- UI 结果是通用的，不展示条件和判断理由；需要排查时请查看 DSH 日志或会话事件。
- 该命令适合“条件明确、指令单一”的场景；需要复杂分支时，建议直接用普通对话。

## License

[MIT](LICENSE)
