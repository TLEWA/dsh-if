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
| 与普通消息同队列 | 模型工作时，`/if` 作为一条普通消息进入输入框上方的队列面板：可以编辑、删除、↑ 插话；回合开始时才判断，成立就把这条消息原地换成指令 |
| 两种排队模式 | 默认 `message`（与普通消息同队列）；`background` 保留 0.2.x 的行为：命令立即返回，判断在后台跑 |
| 条件成立才发送 | 只有 `YES` 才把指令作为用户消息发给主 agent，`NO` 完全不触发主 agent |
| 判断不进上下文 | 判断在独立子会话里完成，不写主会话事件，不调用 `agent.inject` |
| 命令不留输入历史 | `recordInput: false`：条件与指令不进输入历史；仅判断失败时，为支撑卡片上的「取回 /if」，把本次原文写入 `command/run` 的 `args` |
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
dsh-if@0.3.5
```

命令行等价写法：

```powershell
dsh plugin --profile desktop add dsh-if@0.3.5
```

### 从 GitHub 安装

`lib/` 是可直接运行的源码，不需要本地构建：

```text
https://github.com/TLEWA/dsh-if
```

固定到标签或 Release 附件：

```powershell
dsh plugin --profile desktop add github:TLEWA/dsh-if#v0.3.5
```

```text
https://github.com/TLEWA/dsh-if/releases/download/v0.3.5/dsh-if-0.3.5.tgz
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

> 分隔符优先：只要出现过单独一行的 `---`，它右边的部分一定全是指令。所以指令正文里
> **不要**单独成行写 `---`（Markdown 水平线），否则它前面的内容会被当成条件的一部分。

### 判断语义

- 判断由当前会话配置的模型完成，不是 JavaScript 或数学求值器。
  `1+1=2` 只是最小示例；条件可以是“用户是否已经确认方案”“上一条回复是否包含错误”等。
- 判断器只被要求输出 `YES` 或 `NO`。输出里没有可识别结果时按判断失败处理，不发送指令。
- 判断器可以只读地查看文件、检索代码来确认事实（`read` / `glob` / `grep` 等），但不能做任何修改。
- 条件需要的信息在当前上下文里找不到、或者条件含糊无法确定时，判为不成立：宁可不动，也不误发指令。
- UI 只显示通用结果，不回显条件、指令或判断原文。

## 配置

```yaml
# profile 的 cordis.patch.yml
- id: if-command
  name: 'dsh-if'
  config:
    mode: message     # 默认。background = 0.2.x 的老行为
```

- `mode: message`（默认）：`/if` 先作为一条普通用户消息排队，等轮次真正开始时再判断。
  条目的内容是 `/if <条件>` + 指令原文，出现在输入框上方的队列面板里，编辑它即等同改条件与指令。
- `mode: background`：0.2.x 行为。命令立即返回“已排队”，判断丢给后台任务，判断过程不占队列。
  适合不想让判断占用一轮队列位置的场景。判断失败时会在会话里记一张 `if` 命令卡片说明原因
  （后台模式没有排队条目可以改写）。

也可以不改文件：**插件 → dsh-if → 配置** 里有「判断方式」下拉框，切换即时生效（`mode` 声明为
volatile 字段，设置页直接改写运行中的配置）。

插件导出 `Config`（`@deepseek-ai/schemastery`）描述这个字段；`mode` 缺省即为 `message`，
未知字段被忽略。

## 工作方式

1. 通过 `ctx.effect(() => ctx.commands.register(...))` 注册 `/if`，并设置 `recordInput: false`；
   注册挂在插件的 fiber 上，停用时一并注销，重新启用不会撞名。
2. **入队。** `message` 模式下，命令立即把原文 `/if <条件>\n<指令>` 作为一条普通 user 消息
   `agent.followup()` 到会话队列：它进的是宿主 durable inbox，所以客户端排队面板照常显示、
   照常可编辑 / 删除 / 插话，输入框也不再被命令占住。
3. **轮次边界拦截。** 回合开始时宿主按 `agent/pre-step` waterfall 领取这批消息；插件拿到 claim 到的
   批次后，把以 `/if` 开头的条目挑出来：`/if` 原文不会进入模型历史，而是先在原地判断——
   成立就把这条消息的 content 换成指令，不成立就从批次里删掉。判断失败（超时、输出不可解析、
   子代理起不来）时，这条消息同样从批次里删掉，并在会话里记一张 `【/if 未执行】` 的错误命令卡片
   （`command/run` + `command/done`，log-only，不进模型请求）：说明失败原因，并保留原始输入供
   点失败卡片右侧的「取回 /if」一键放回。卡片记在这一轮结束之后，所以不会被折进收起的
   turn-process 里；批次因此可能变空，宿主会直接结束这一轮 —— 判断失败的
   `/if` 不会给主线模型发任何请求，也不会凭空消失。
4. **首选：fork 子代理判断。** 通过 `ctx.subagents.getProvider('fork')` 取 provider（要求
   `inheritsParentContext === true`），再用 `startActivation({ provider: 'fork', childId, request: { parent, agentOptions, prompt }, delivery: 'caller' })`
   启动判断子会话。请求里只有一条尾部 user 消息（判断规则 + 条件）；tools、system prompt、历史消息全部原样继承，
   前缀与主会话下一次请求逐字节一致。
5. **丢掉继承来的待办。** fork 的种子是父会话到最后一个 `turn/end` 为止的全部事件，而 turn 结束前
   入队的 next-turn 消息、以及还没被领走的 next-step 插话也落在里面。子会话会把它们当成自己的任务
   先跑一遍（判断结果就会错位到别的回合，插话甚至会变成判断子会话的执行内容）。所以拿到子 agent
   的那一刻，插件把子会话 inbox 里 `nextTurn` 和 `nextStep` 两条队列中除自己判断 prompt 以外的
   待办全部 `remove` 掉；父会话的队列不受影响。
6. **执行期只读限制。** 子会话继承完整工具目录，但 `ctx.tools.guard` 注册的 guard 只对判断子会话生效：
   `read` / `glob` / `grep` / `web_search` / `web_fetch` / `skill` 等只读工具放行，
   写入、修改、执行命令、子代理等一律返回拒绝文案。工具目录不裁剪，所以缓存前缀不变。
7. 判断超时 60 秒；只有 `YES` 时把指令作为一条带 `id` 和 `role: 'user'` 的已识别消息交给主 agent；
   `NO` 时这条排队消息被丢弃，完全不触发主 agent。
8. **回退路径。** host 没有可继承上下文的 fork provider 时，`historyTranscript()` 读取
   `agent.session.deriveMessages()`，只保留 user / assistant / tool 消息，生成最多约 24k 字符的纯文本记录
   （每条消息最多 3k 字符，保留头尾），再用 `ctx.llm.stream()` 发起一次性判断请求。
   该请求不带主会话 `sessionId`，因此命中不了主缓存，只作为兼容退路。
9. **`background` 模式**跳过第 2、3 步：命令把判断交给后台任务并立刻返回“已排队”，
   判断结果直接以 `agent.followup` 交付（成功是指令；失败是一张 `【/if 未执行】` 命令卡片）。
   多个 `/if` 按发送顺序串行判断，不会因为同一时刻被唤醒而乱序。

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

- 已在 DSH `0.2.1-rc.5` 与 `0.2.2-rc.1`、Windows 桌面端验证；
- 0.2.2 起宿主在 pre-step 之前固定本步模型：判断优先使用该步的 `modelSelection` 或
  `agent.model.current()`，再把同一路由钉进 fork 子会话（0.2.1 没有这些 API 时退回请求头与
  `agent.options`，行为不变）；
- 命令使用 `@deepseek-ai/dsh-commands` 的公开注册接口；
- 判断优先使用 `ctx.subagents` 的 `fork` provider + `ctx.tools.guard`；host 不提供时自动回退到 `ctx.llm.stream`；
- 不依赖客户端 bundle，不需要构建步骤。

## 测试

```powershell
npm test
npm run test:slow
```

测试使用 mock 的 `ctx.commands`、`ctx.llm`、`ctx.subagents`、`ctx.tools` 和 `agent`，覆盖：

- 注册信息与 `recordInput: false`
- fork 判断只追加一条尾部消息、`agentOptions.maxTokens` 收敛、子会话被释放
- `YES` 只发送指令、`NO` 不发送
- 判断输出里的 tool-call 标记会被剥离，`MAYBE` 之类的输出按失败处理
- guard 只拦判断子会话：`write` / `pwsh` 被拒，`read` / `grep` 放行，其它会话不受影响，判断结束即释放归属
- fork 子会话会丢弃从父会话队列继承来的待办——`nextTurn` 和 `nextStep` 都清，只留自己的判断 prompt
- `mode: message`：默认把命令转成普通排队消息；轮次边界把 `/if` 换成指令、`NO` 时丢弃、普通消息不判断
- `mode: background`：命令立即返回"已排队"，判断异步完成；多个 `/if` 保持发送顺序
- 没有可继承上下文的 fork provider 时回退到 transcript 判断，且绝不复用不继承前缀的 provider
- fork 启动失败时回退到 transcript 判断；两条路都失败时记一张 `【/if 未执行】` 命令卡片而不是静默丢弃，
  且不会给主线模型发消息
- 判断超时（provider 完全忽略 `AbortSignal`）也会在 60 秒后结束，不会卡住回合
- `---` 多行条件
- 缺少指令 / 空指令
- 过滤 system / developer 消息
- 不支持 `reasoningEffort` 时的重试
- 判断 prompt 不含指令，结果文本不含条件或判断原文
- 发送的指令消息带 `id` 和 `role: 'user'`，持久化 session 可以正常重载
- 假回合循环（`test/loop.test.mjs`）：按宿主的真实领取顺序（先 next-step、再一条 next-turn）跑一轮，
  验证指令在 step 提交前就被替换、`NO` 不会打开 step、判断失败时这一轮不打开 step 且留下命令卡片
- 客户端（`test/client.test.mjs`）：设置行读写、宿主拒绝写入时不显示“已保存”、加载中不显示只读文案、
  失败卡片右侧的「取回 /if」（注册为 `conversation.chat.commandview` 的 `if` key）把卡片里的原文插回输入框、卸载时释放订阅

## 隐私

- 插件不含遥测、统计上报或第三方远程请求。
- 判断时会把“当前会话已有上下文 + 条件”发送给当前会话配置的模型提供商，与正常对话走同一条模型通道。
- 条件和上下文可能包含敏感信息；不要把不希望发送给模型提供商的内容写进 `/if` 条件。

## 已知限制

- 判断在宿主里是一个真实的子代理回合：桌面端会在会话时间线上显示一张子代理卡片
  （label 为 `if judge`，含耗时、费用与 token 用量），判断结束即释放。主会话的消息列表
  不会因此多出任何 judge 消息——那张卡片属于独立子会话。
- `/if` 在排队面板里是一条普通用户消息的副本：内容是 `/if <条件>` + 指令原文。它会在回合开始前被
  替换成指令（成立）或丢弃（不成立），所以不会出现在模型历史里；编辑它就等于同时改条件与指令。
- 判断失败时不会静默丢弃，也不会打扰主线模型：那条 `/if` 会从批次里移除，同时在会话里记一张
  `【/if 未执行】` 命令卡片（失败原因 + 可展开的说明），点这张卡片右侧的「取回 /if」即可把原文
  放回输入框重发。`background` 模式没有排队条目，失败时同样记一张命令卡片。日志里也会留一条 warning。
- 只读白名单是静态名单：未列出的工具（包括 MCP 只读工具）会被拒绝；需要放宽时请提 issue。
- 回退路径（host 没有 fork provider）看到的是纯文本记录，图片和文件只显示 `[图片]` / `[文件]` 占位符，
  条件需要的信息如果不在最近约 24k 字符的记录里，会被判为不成立。
- 判断使用当前会话的 provider/model；当前会话没有可用路由时返回错误。
- UI 结果是通用的，不展示条件和判断理由；需要排查时请查看 DSH 日志或会话事件。
- 该命令适合“条件明确、指令单一”的场景；需要复杂分支时，建议直接用普通对话。

## 我的其他 DSH 项目

`/if` 只是 DSH 的一小块。下面这些插件都由我维护，按需取用。

- **[dsh-sidebar-row-menu](https://github.com/TLEWA/dsh-sidebar-row-menu)** —— 侧栏行右键菜单：工作区行、会话行与会话正文各有自己的右键菜单，含「打开方式」「更多操作」二级菜单。
- **[dsh-sidebar-organizer](https://github.com/TLEWA/dsh-sidebar-organizer)** —— 七区域布局整理器：侧栏、侧栏底部、对话标签、输入框、会话头部、右侧栏、设置导航都能长按拖拽排序，面板可以收进「更多」再拖回来。
- **[dsh-better-choice](https://github.com/TLEWA/dsh-better-choice)** —— `ask_user_question` 增强：右键选项补备注，选之前先拿同一份上下文旁问模型一句。
- **[dsh-utf8-output](https://github.com/TLEWA/dsh-utf8-output)** —— 修复 Windows 下 DSH 子进程 GBK/CP936/CP932 输出乱码。
- **[dsh-opencode-go-router](https://github.com/TLEWA/dsh-opencode-go-router)** —— 上下文折叠或系统提示被重写后轮换 OpenCode Go 路由，少丢一点提示缓存。
- **[dsh-fastload](https://github.com/TLEWA/dsh-fastload)** —— 长会话首屏历史瘦身：缩小首次打开时的历史页，同时保留用户实际看到的尾部内容。
- **[dsh-ptc-noargs](https://github.com/TLEWA/dsh-ptc-noargs)** —— 修复 PTC `run_code` 中无参工具调用被拒绝的问题：把省略或 `undefined` 的首参归一化为 `{}`。

## License

[MIT](LICENSE)
