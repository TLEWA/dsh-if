# NOTICE / 第三方声明

[简体中文](NOTICE.md) · [English](NOTICE.en.md)

`dsh-if` 不包含复制或改编的第三方源代码、客户端组件或素材。

## 运行时依赖

- 只使用 Node.js 内置模块（`node:crypto`）；
- 只通过公开接口对接 DSH 宿主服务：`ctx.commands`、`ctx.llm`、`ctx.subagents`、`ctx.tools`、`agent.session` 与 `agent.followup`；
- 不打包、不复制 DSH 或其内置包的源代码。

“用 fork 子代理共享主会话请求前缀”的做法参考了 [`@michengai/dsh-btw`](https://github.com/MichengAI/dsh-btw)
的公开实现（同样是宿主公开 API 的用法），未复制其代码。

DeepSeek Harness（DSH）及其内置包的版权归 DeepSeek 所有。本项目仅通过公开接口与运行时行为集成，不主张其版权。

## AI 辅助

本项目的代码与文档在 AI 辅助下完成，范围、验证方式与免责声明见 [AI_USAGE.md](AI_USAGE.md)。
