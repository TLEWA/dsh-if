# AGENTS.md

本仓库是一个 DSH 插件。开工前先读仓库的 `README.md`；通用流程与检查项看中心仓的 [PROCESS.md](https://github.com/TLEWA/dsh-plugin-ci/blob/v1/PROCESS.md) 与 [docs/gates.md](https://github.com/TLEWA/dsh-plugin-ci/blob/v1/docs/gates.md)。本文件只强调本类仓库最容易出错的点。

## 插件的硬性约束

- `package.json` 必须有顶层 `engines.dsh`；写在 `dsh.engines.dsh` 会被忽略。
- `dsh.manifestVersion` 必须是 1，`dsh.bundle.patch` 必须指向真实存在的 `cordis.patch.yml`。
- `cordis.patch.yml` 里 `insert[].name` 必须等于包名；`id` 是用户可见的短名，不要随意改。
- `dsh.client.inject` 只允许 `@deepseek-ai/*`，裸模块名（如 `react`）不会被打包。
- `lib/` 是直接运行的源码（本仓库没有构建步骤）；不要新增 build 步骤，也不要把 `lib/index.js` 改成生成物。
- `package.json` 的 `scripts.prepublishOnly` 必须调用 `dsh-ci-gate --prepublish`；它拦截本机 `npm publish`，不要删除或绕过。

## 本仓库专属

`dsh-if` 是 `/if` 命令：先让 judge 结合上下文判断条件，成立才把指令作为用户消息发出。
`lib/index.js` 与 `lib/client.js` 都是源码，没有构建步骤。

- 命令必须 `recordInput: false`；`/if` 不能作为普通命令进入 durable queue 的正式记录。
- message 模式：`/if` 先以普通 user 消息排队，在 `agent/pre-step` 原地替换成指令或丢弃；
  判断过程和结果不得写进主会话历史。
- judge 只用 `inheritsParentContext` 的 fork provider；只追加一条尾部 user 消息，guard 只读；
  不要复用不继承前缀的 provider。
- 判断失败不能静默：留 log-only 命令卡片 `【/if 未执行】`，不向主线模型发消息，也不丢用户输入。
- `test/run.mjs` 必须 in-process 导入 if/loop/client 三个 suite 后 `run({concurrency:1})`；
  `node --test test/` 在 DSH 沙箱会 spawn EPERM，不要改回去。
- 新增 suite 要同时加到 `run.mjs` 的 import 和 `npm run check` 的 `node --check` 列表。
- 隐私：judge prompt 不含指令正文；结果与日志不泄露条件和判断原文。
- `@deepseek-ai/schemastery` 是生产依赖；`mode` 是 volatile 配置，不要持久化。

## 每次改动

1. 从最新 main 开 `feat/` 或 `fix/` 分支。
2. 改代码、测试、双语文档与 CHANGELOG（同一个 PR）。
3. 本地跑 gate，全绿再 push；不要复制 gate 脚本，CI 会通过 `.ci` 运行中心仓的版本。
4. 开 PR 并按模板勾选；`ci / ci-ok` 通过后由维护者合并。改 CI、AGENTS 或 PR 模板必须加 `ci-change`；
   `human-approved` 只能由人加，模型不得自行添加。

```bash
npx --yes --package=github:TLEWA/dsh-plugin-ci#v1 dsh-ci-gate
npm test
```

## 发布

只由维护者打 tag 触发 `release.yml`。模型不得执行 `npm publish`、不得改版本号（除非在 `release/` 分支上且被明确要求）。
