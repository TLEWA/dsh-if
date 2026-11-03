# dsh-if

[![CI](https://github.com/TLEWA/dsh-if/actions/workflows/ci.yml/badge.svg)](https://github.com/TLEWA/dsh-if/actions/workflows/ci.yml)
[![Release](https://github.com/TLEWA/dsh-if/actions/workflows/release.yml/badge.svg)](https://github.com/TLEWA/dsh-if/releases)
[![npm version](https://img.shields.io/npm/v/dsh-if.svg)](https://www.npmjs.com/package/dsh-if)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

[简体中文](README.md) · [English](README.en.md)

A custom `/if` command for [DeepSeek Harness](https://github.com/deepseek-ai) (DSH):

> A condition is judged first: the judge is a **forked subagent** that inherits the current
> session's tools, system prompt, and message history and adds exactly one trailing judgment
> message. If the condition holds, the instruction below it is sent to the main agent as an
> ordinary user message; if not, nothing happens.

The judge request shares the same prefix as the main session's next request (tools → system →
messages, byte-identical), so it reuses the provider's prompt cache / KV cache. The `/if`
command, the condition, the judge prompt, and the verdict **never enter the main session**.
When the condition holds, the only change is one appended user message at the tail; the
existing prefix is not rewritten.

## Features

| Capability | Behavior |
| --- | --- |
| Context-aware condition | The judge inherits the full session context (tools + system prompt + history) and answers `YES` or `NO` |
| Reuses the KV cache | The forked judge appends one trailing user message; tools / system / messages stay byte-identical to the main request |
| Read-only judging | The tool catalog is never trimmed (that is what keeps the prefix identical); an execution-time guard allows `read` / `glob` / `grep` and other inspection tools, and refuses writes, commands, and subagents |
| Shares the queue | While a turn runs, `/if` queues itself as an ordinary message in the composer's queue dock — editable, removable, steerable — and is judged when the turn opens; a `YES` turns that very message into the instruction |
| Two queueing modes | `message` (default) shares the queue; `background` keeps the 0.2.x behavior: the command returns at once and judges in a background task |
| Send only when true | Only `YES` sends the instruction as a user message; `NO` never wakes the main agent |
| Judgment stays out of context | Judging happens in a separate child session; no main-session event and no `agent.inject` |
| Command arguments stay private | `recordInput: false`, so even the log-only `command/run` event omits them |
| Multi-line conditions | First line is the condition, the rest is the instruction; use a lone `---` line for multi-line conditions |
| Automatic fallback | When the host has no prefix-inheriting fork provider, the judge falls back to one `ctx.llm.stream` call over a ~24k-character plain-text transcript |
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
dsh-if@0.3.0
```

Equivalent CLI command:

```powershell
dsh plugin --profile desktop add dsh-if@0.3.0
```

### From GitHub

`lib/` is ready to run; no local build is required:

```text
https://github.com/TLEWA/dsh-if
```

Pin a tag or the release tarball:

```powershell
dsh plugin --profile desktop add github:TLEWA/dsh-if#v0.3.0
```

```text
https://github.com/TLEWA/dsh-if/releases/download/v0.3.0/dsh-if-0.3.0.tgz
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
- The judge may inspect files and search code with read-only tools (`read` / `glob` /
  `grep` and friends), but it cannot change anything.
- If the information needed by the condition is not available in the current context, or the
  condition is ambiguous, it is treated as false: doing nothing is safer than sending by mistake.
- The UI only shows a generic result; it never echoes the condition, instruction, or verdict.

## Configuration

```yaml
# the profile's cordis.patch.yml
- id: if-command
  name: 'dsh-if'
  config:
    mode: message     # default; background restores the 0.2.x behavior
```

- `mode: message` (default): `/if` first queues itself as an ordinary user message and is judged
  when the turn actually opens. The entry is the literal `/if <condition>` plus the instruction and
  shows up in the queue dock above the composer, so editing it edits condition and instruction.
- `mode: background`: the 0.2.x behavior. The command returns "queued" at once and the judgement
  runs in a background task, outside the session queue.

The plugin exports no `Config` schema, so the host hands the raw `config` object to
`apply(ctx, config)`; unknown keys are ignored and a missing `mode` means `message`.

## How it works

1. `ctx.commands.register` registers `/if` with `recordInput: false`.
2. **Queueing.** In `message` mode the command immediately queues the literal
   `/if <condition>\n<instruction>` as an ordinary user message via `agent.followup()`. It lands in
   the host's durable inbox, so the queue dock shows it and can edit / remove / steer it, and the
   composer is never held by the command.
3. **Interception at the turn boundary.** When the turn opens, the host claims that batch through
   the `agent/pre-step` waterfall; the plugin takes the claimed messages, picks the ones starting
   with `/if`, and judges them in place — the literal `/if` line never reaches the model history.
   On `YES` the message's content is replaced by the instruction; on `NO` the message is dropped.
   If the whole batch is dropped, the host opens no step and the turn closes immediately.
4. **Preferred path: a forked judge.** It resolves `ctx.subagents.getProvider('fork')`
   (requiring `inheritsParentContext === true`) and starts the child with
   `startActivation({ provider: 'fork', childId, request: { parent, agentOptions, prompt }, delivery: 'caller' })`.
   The request adds only one trailing user message (judging rules + condition); tools, system
   prompt, and history are inherited verbatim, so the prefix matches the main session's next request.
5. **Inherited work is dropped.** The fork seed is the parent's log up to the last `turn/end`, and
   next-turn messages queued before that boundary fall inside it. A child would run those copies as
   its own turns first, so the verdict lands on the wrong turn. The plugin therefore removes every
   pending inbox item except its own judge prompt when the child is created; the parent's queue is
   untouched.
6. **Read-only at execution time.** The child inherits the full tool catalog, but a
   `ctx.tools.guard` guard — scoped to judge children only — allows `read` / `glob` / `grep` /
   `web_search` / `web_fetch` / `skill` and refuses every mutating or executing tool. The tool
   catalog is not filtered, so the cached prefix is unaffected.
7. The judge times out after 60 seconds. Only on `YES` the instruction is handed to the main agent
   as an identified user message with `id` and `role: 'user'`. On `NO`, the queued message is
   dropped and the main agent is not touched.
8. **Fallback path.** When the host has no prefix-inheriting fork provider, `historyTranscript()`
   reads `agent.session.deriveMessages()`, keeps only user / assistant / tool messages, and
   builds a plain-text transcript of at most ~24k characters (each message clipped to 3k
   characters, keeping head and tail). One `ctx.llm.stream()` call then judges it. That request
   carries no main-session `sessionId`, so it cannot hit the main cache; it exists for
   compatibility only.
9. **`background` mode** skips steps 2–3: the command reads `session.snapshotEvents()`, and while
   a turn is open it hands the judgement to a background task and returns "queued" immediately;
   the task waits for the turn to close (up to 30 minutes), then judges and delivers.

## KV cache and context isolation

This is a design constraint, not an option:

- The `/if` command, condition, instruction, judge prompt, and verdict are never written to
  the main session. `command/run` and `command/done` are log-only events and do not enter a
  model request.
- Judging happens in a **forked subagent**: tools, system prompt, and history are inherited and
  only one trailing user message is added. The prefix is therefore byte-identical to the main
  session's next request, so the provider's prefix cache / KV cache is reused instead of being
  re-paid for the whole context.
- The child is a separate session: it appends no main-session events and only reads history.
  The tool catalog is not trimmed either (trimming tool declarations would change the prefix and
  break the cache); the read-only restriction lives in the execution-time guard instead.
- The trade-off is visible: every judgment resends the whole context, tokens are counted in
  full, and the cached portion is billed at the provider's cache rate. The longer the session,
  the larger the absolute token count of one judgment (the hit rate decides the actual cost).
- On `NO`, the main session is unchanged.
- On `YES`, the only change is a normal user message appended at the **tail** via
  `agent.followup`. Earlier messages, the system prompt, and tool declarations are unchanged,
  so the reusable prefix of the main request stays byte-identical.
- The plugin never calls `agent.inject` to put the verdict into context, and never edits,
  replaces, or deletes existing session events.

## Compatibility

- Verified on DSH `0.2.1-rc.5`, Windows desktop;
- Uses the public `@deepseek-ai/dsh-commands` registration API;
- Prefers the `ctx.subagents` `fork` provider plus `ctx.tools.guard`, and falls back to
  `ctx.llm.stream` when the host does not provide them;
- No client bundle and no build step.

## Tests

```powershell
npm test
```

The tests use mocked `ctx.commands`, `ctx.llm`, `ctx.subagents`, `ctx.tools`, and `agent`, and cover:

- registration and `recordInput: false`
- the forked judge adding exactly one trailing message, clamping `agentOptions.maxTokens`, and
  disposing the child session
- `YES` sends exactly the instruction; `NO` sends nothing
- tool-call markup in the judge output is stripped; output like `MAYBE` fails closed
- the guard only covers judge children: `write` / `pwsh` are refused, `read` / `grep` pass,
  other sessions are untouched, and ownership is released once judging ends
- the forked child drops work inherited from the parent's queue and keeps only its judge prompt
- `mode: message`: the command turns itself into an ordinary queued message; the turn boundary
  replaces `/if` with the instruction, drops it on `NO`, and leaves ordinary messages alone
- `mode: background`: acknowledges at once while busy and judges after the turn closes
- falling back to the transcript judge when no prefix-inheriting provider exists, and never
  using a non-inheriting provider
- a failing fork activation surfaces as a judge error and sends nothing
- `---` multi-line conditions
- missing instruction / empty instruction
- filtering system / developer messages
- retry when `reasoningEffort` is unsupported
- judge prompt excludes the instruction; result text excludes the condition/verdict
- the sent instruction carries `id` and `role: 'user'` so persisted sessions reload cleanly

## Privacy

- No telemetry, analytics, or third-party remote requests.
- The judge sends "existing session context + condition" to the model provider configured
  for the current session, over the same model channel as normal chat.
- Conditions and context may contain sensitive data; do not put anything into `/if` that
  you would not send to your model provider.

## Known limitations

- Judging is a real subagent turn: the desktop UI shows a subagent card on the session
  timeline (label `if judge`, with elapsed time, cost and token usage) until the judge is
  disposed. The main session gains no judge messages — that card belongs to the separate
  child session.
- A queued `/if` is a copy of an ordinary user message (`/if <condition>` + instruction). It is
  replaced by the instruction (YES) or dropped (NO) before the turn opens, so it never reaches model
  history; editing it edits both the condition and the instruction.
- If judging fails (timeout, unrecognized verdict, no available route), the queued message is dropped
  too and only a warning is logged. The UI shows nothing extra; check `command/done` and the DSH log.
- The read-only allowlist is static: tools that are not listed — including read-only MCP
  tools — are refused. Open an issue if you need one added.
- On the fallback path the judge sees a plain-text transcript; images and files appear only as
  `[image]` / `[file]` placeholders, and information outside the last ~24k characters is
  treated as unavailable.
- The judge uses the current session's provider/model; if no route is available, the command
  returns an error.
- The UI result is generic and does not show the condition or reasoning; inspect DSH logs or
  session events when debugging.
- This command is intended for clear conditions and a single instruction. For complex
  branching, use ordinary chat.

## License

[MIT](LICENSE)
