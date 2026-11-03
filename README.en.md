# dsh-if

[![CI](https://github.com/TLEWA/dsh-if/actions/workflows/ci.yml/badge.svg)](https://github.com/TLEWA/dsh-if/actions/workflows/ci.yml)
[![Release](https://github.com/TLEWA/dsh-if/actions/workflows/release.yml/badge.svg)](https://github.com/TLEWA/dsh-if/releases)
[![npm version](https://img.shields.io/npm/v/dsh-if.svg)](https://www.npmjs.com/package/dsh-if)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

[简体中文](README.md) · [English](README.en.md)

A custom `/if` command for [DeepSeek Harness](https://github.com/deepseek-ai) (DSH):

> A separate LLM call judges a condition against the **prior conversation context**.
> If it holds, the instruction below the condition is sent to the main agent as an
> ordinary user message; if not, nothing happens.

The `/if` command, the condition, the judge prompt, and the verdict **never enter the
main agent's context**. When the condition holds, the only change is one appended user
message at the tail of the history; the existing prefix is not rewritten.

## Features

| Capability | Behavior |
| --- | --- |
| Context-aware condition | The judge reads existing user / assistant / tool messages and answers `YES` or `NO` |
| Send only when true | Only `YES` sends the instruction as a user message; `NO` never wakes the main agent |
| Judgment stays out of context | A separate request with no main-session `sessionId`; no session event and no `agent.inject` |
| Command arguments stay private | `recordInput: false`, so even the log-only `command/run` event omits them |
| Multi-line conditions | First line is the condition, the rest is the instruction; use a lone `---` line for multi-line conditions |
| Fail closed | Empty condition/instruction, an unrecognized verdict, or a timeout returns an error and sends nothing |

## Install

Requirements:

- DSH `0.2.1-rc.5` or newer;
- Node.js `20.3` or newer (`AbortSignal.any` / `AbortSignal.timeout`).

### From npm (recommended)

1. Open **Plugins** in the sidebar → **Install plugin**;
2. Enter the package name:

   ```text
   dsh-if
   ```

3. Restart DSH after installation (host plugins load when the profile starts).

Pin a version:

```text
dsh-if@0.1.0
```

Equivalent CLI command:

```powershell
dsh plugin --profile desktop add dsh-if@0.1.0
```

### From GitHub

`lib/` is ready to run; no local build is required:

```text
https://github.com/TLEWA/dsh-if
```

Pin a tag or the release tarball:

```powershell
dsh plugin --profile desktop add github:TLEWA/dsh-if#v0.1.0
```

```text
https://github.com/TLEWA/dsh-if/releases/download/v0.1.0/dsh-if-0.1.0.tgz
```

### From source

```powershell
git clone https://github.com/TLEWA/dsh-if.git
cd dsh-if
npm test
dsh plugin --profile desktop add .
```

After restarting DSH, type `/if` in the composer; the slash palette will show it.

## Usage

Basic form: the first line is the condition, the remaining lines are the instruction.

```text
/if 1+1=2
Reply with exactly OK
```

For a multi-line condition, separate it from the instruction with a lone `---` line:

```text
/if the user has approved plan A
and the tests have passed
---
Start executing plan A
```

### Judgment semantics

- The judge is the model configured for the current session, not a JavaScript or math
  evaluator. `1+1=2` is only a minimal example; conditions can be "has the user approved
  the plan?" or "did the previous reply contain an error?".
- The judge is asked to output exactly `YES` or `NO`. If no verdict can be parsed, the
  command fails closed and sends nothing.
- If the information needed by the condition is outside the last ~24k characters of
  context, the condition is treated as false: doing nothing is safer than sending by mistake.
- The UI only shows a generic result; it never echoes the condition, instruction, or verdict.

## How it works

1. `ctx.commands.register` registers `/if` with `recordInput: false`.
2. `historyTranscript()` reads `agent.session.deriveMessages()`, keeps only user / assistant /
   tool messages, and builds a plain-text transcript of at most ~24k characters (each message
   is clipped to 3k characters, keeping head and tail). System / developer messages are excluded.
3. `ctx.llm.stream()` makes a separate judge request. The system prompt requires exactly
   `YES` or `NO` and treats the transcript as data. It prefers `agent.options` for the
   provider/model, then falls back to `session.requestHeader()?.config`, then
   `llm.listProviders()` / `listModels()`. It uses `reasoningEffort: 'off'` and retries once
   without that field if the provider rejects it. Timeout: 30 seconds.
4. Only on `YES`, `agent.followup(...)` appends the instruction as an identified user message
   with `id` and `role: 'user'`. On `NO`, the main agent is not touched.

## KV cache and context isolation

This is a design constraint, not an option:

- The `/if` command, condition, instruction, judge prompt, and verdict are never written to
  the main session. `command/run` and `command/done` are log-only events and do not enter a
  model request.
- The judge is a **separate request** without the main session's `sessionId`. It appends no
  session events; it only reads history.
- On `NO`, the main session is unchanged.
- On `YES`, the only change is a normal user message appended at the **tail** via
  `agent.followup`. Earlier messages, the system prompt, and tool declarations are unchanged,
  so the reusable prefix of the main request stays byte-identical and the provider's prefix
  cache / KV cache is not rewritten by this command.
- The plugin never calls `agent.inject` to put the verdict into context, and never edits,
  replaces, or deletes existing session events.

## Compatibility

- Verified on DSH `0.2.1-rc.5`, Windows desktop;
- Uses the public `@deepseek-ai/dsh-commands` registration API;
- Uses the public `ctx.llm.stream` API;
- No client bundle and no build step.

## Tests

```powershell
npm test
```

The tests use mocked `ctx.commands`, `ctx.llm`, and `agent` and cover:

- registration and `recordInput: false`
- `YES` sends exactly the instruction; `NO` sends nothing
- `---` multi-line conditions
- missing instruction / empty instruction
- filtering system / developer messages
- unrecognized verdict
- retry when `reasoningEffort` is unsupported
- judge prompt excludes the instruction; result text excludes the condition/verdict
- judge call has no `sessionId` and does not mutate history
- the sent instruction carries `id` and `role: 'user'` so persisted sessions reload cleanly

## Privacy

- No telemetry, analytics, or third-party remote requests.
- The judge sends "existing session context + condition" to the model provider configured
  for the current session, over the same model channel as normal chat.
- Conditions and context may contain sensitive data; do not put anything into `/if` that
  you would not send to your model provider.

## Known limitations

- The judge sees a plain-text transcript; images and files appear only as `[image]` / `[file]`
  placeholders.
- If the information needed by the condition is outside the last ~24k characters, the
  condition is treated as false.
- The judge uses the current session's provider/model; if no route is available, the command
  returns an error.
- The UI result is generic and does not show the condition or reasoning; inspect DSH logs or
  session events when debugging.
- This command is intended for clear conditions and a single instruction. For complex
  branching, use ordinary chat.

## License

[MIT](LICENSE)
