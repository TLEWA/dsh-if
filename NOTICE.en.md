# NOTICE / Third-party attributions

[简体中文](NOTICE.md) · [English](NOTICE.en.md)

`dsh-if` contains no copied or adapted third-party source code, client components, or assets.

## Runtime dependencies

- Node.js built-ins only (`node:crypto`);
- Integrates with DSH host services through public interfaces only: `ctx.commands`,
  `ctx.llm`, `agent.session`, and `agent.followup`;
- Does not bundle or copy the source of DSH or its bundled packages.

DeepSeek Harness (DSH) and its bundled packages remain copyright DeepSeek. This project
integrates through public interfaces and runtime behavior only and claims no copyright in them.

## AI assistance

The code and documentation were produced with AI assistance. Scope, verification, and
disclaimers are documented in [AI_USAGE.en.md](AI_USAGE.en.md).
