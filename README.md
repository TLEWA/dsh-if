# dsh-if

[![CI](https://github.com/TLEWA/dsh-if/actions/workflows/ci.yml/badge.svg)](https://github.com/TLEWA/dsh-if/actions/workflows/ci.yml)
[![Release](https://github.com/TLEWA/dsh-if/actions/workflows/release.yml/badge.svg)](https://github.com/TLEWA/dsh-if/releases)
[![npm version](https://img.shields.io/npm/v/dsh-if.svg)](https://www.npmjs.com/package/dsh-if)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

[简体中文](README.md) · [English](README.en.md)

给 [DeepSeek Harness](https://github.com/deepseek-ai)（DSH）加一个自定义 `/if` 命令：

> 先用一次独立的 LLM 调用，根据**先前的对话上下文**判断条件是否成立；
> 成立时，把下方的指令作为一条普通用户消息发给主 agent；不成立时什么都不做。

`/if` 命令、条件、判断用的 prompt 和判断结果**都不会进入主 agent 的上下文**。
条件成立时，主会话只在历史末尾多一条普通用户消息，不会改写已有前缀。

## 功能

| 能力 | 行为 |
| --- | --- |
| 上下文条件判断 | 判断器读取当前会话已有的 user / assistant / tool 消息，按条件回答 `YES` 或 `NO` |
| 条件成立才发送 | 只有 `YES` 才把指令作为用户消息发给主 agent，`NO` 完全不触发主 agent |
| 判断不进上下文 | 判断是独立请求，不带主会话 `sessionId`，不追加 session 事件，不调用 `agent.inject` |
| 命令不泄露参数 | `recordInput: false`，log-only 的 `command/run` 也不记录条件或指令 |
| 多行条件 | 第一行是条件，其余行是指令；条件有多行时用单独一行 `---` 分隔 |
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
dsh-if@0.1.0
```

命令行等价写法：

```powershell
dsh plugin --profile desktop add dsh-if@0.1.0
```

### 从 GitHub 安装

`lib/` 是可直接运行的源码，不需要本地构建：

```text
https://github.com/TLEWA/dsh-if
```

固定到标签或 Release 附件：

```powershell
dsh plugin --profile desktop add github:TLEWA/dsh-if#v0.1.0
```

```text
https://github.com/TLEWA/dsh-if/releases/download/v0.1.0/dsh-if-0.1.0.tgz
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
- 条件需要的信息如果不在最近约 24k 字符的上下文里，会被判为不成立：宁可不动，也不误发指令。
- UI 只显示通用结果，不回显条件、指令或判断原文。

## 工作方式

1. `ctx.commands.register` 注册 `/if`，并设置 `recordInput: false`。
2. `historyTranscript()` 读取 `agent.session.deriveMessages()`，只保留 user / assistant / tool 消息，
   生成最多约 24k 字符的纯文本记录（每条消息最多 3k 字符，保留头尾）。system / developer 消息不进入判断 prompt。
3. `ctx.llm.stream()` 发起独立判断请求，system prompt 要求只输出 `YES` 或 `NO`，并把对话记录明确标为数据。
   优先使用 `agent.options` 的 provider/model，缺失时回退到 `session.requestHeader()?.config`，
   再回退到 `llm.listProviders()` / `listModels()`。默认 `reasoningEffort: 'off'`；
   provider 不支持时自动去掉该参数重试一次。超时 30 秒。
4. 只有 `YES` 时调用 `agent.followup(...)`，把指令作为一条带 `id` 和 `role: 'user'` 的已识别消息
   追加到主会话；`NO` 时完全不触发主 agent。

## KV 缓存与上下文隔离

这是设计约束，不是可选项：

- `/if` 命令、条件、指令、判断 prompt、判断结果都不写入主会话；
  `command/run` 和 `command/done` 是 log-only 事件，不进入模型请求。
- 判断调用是**独立请求**，不带主会话的 `sessionId`，不追加任何 session 事件；它只读历史，不修改历史。
- 条件不成立（`NO`）时，主会话没有任何变化。
- 条件成立（`YES`）时，唯一的改动是通过 `agent.followup` 在历史**末尾追加**一条普通用户消息。
  之前的消息、system prompt、工具声明都不变，因此主请求的可复用前缀保持字节一致，
  provider 的 prefix cache / KV cache 不会被这次命令改写。
- 插件不会调用 `agent.inject` 把判断结果塞进上下文，也不会编辑、替换或删除已有 session 事件。

## 兼容性

- 已在 DSH `0.2.1-rc.5`、Windows 桌面端验证；
- 命令使用 `@deepseek-ai/dsh-commands` 的公开注册接口；
- 判断使用 `ctx.llm.stream` 的公开接口；
- 不依赖客户端 bundle，不需要构建步骤。

## 测试

```powershell
npm test
```

测试使用 mock 的 `ctx.commands`、`ctx.llm` 和 `agent`，覆盖：

- 注册信息与 `recordInput: false`
- `YES` 只发送指令、`NO` 不发送
- `---` 多行条件
- 缺少指令 / 空指令
- 过滤 system / developer 消息
- 无法识别的判断结果
- 不支持 `reasoningEffort` 时的重试
- 判断 prompt 不含指令，结果文本不含条件或判断原文
- 判断调用不携带 `sessionId`，且不会修改既有历史
- 发送的指令消息带 `id` 和 `role: 'user'`，持久化 session 可以正常重载

## 隐私

- 插件不含遥测、统计上报或第三方远程请求。
- 判断时会把“当前会话已有上下文 + 条件”发送给当前会话配置的模型提供商，与正常对话走同一条模型通道。
- 条件和上下文可能包含敏感信息；不要把不希望发送给模型提供商的内容写进 `/if` 条件。

## 已知限制

- 判断器看到的是纯文本记录，图片和文件只显示 `[图片]` / `[文件]` 占位符。
- 条件需要的信息如果不在最近约 24k 字符的记录里，会被判为不成立。
- 判断使用当前会话的 provider/model；当前会话没有可用路由时返回错误。
- UI 结果是通用的，不展示条件和判断理由；需要排查时请查看 DSH 日志或会话事件。
- 该命令适合“条件明确、指令单一”的场景；需要复杂分支时，建议直接用普通对话。

## License

[MIT](LICENSE)
