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
| Context-aware condition | The judge inherits the full session context (tools + system prompt + history) and may answer only `Yes` or `No` |
| Reuses the KV cache | The forked judge appends one trailing user message; tools / system / messages stay byte-identical to the main request |
| Read-only judging | The tool catalog is never trimmed (that is what keeps the prefix identical); an execution-time guard allows `read` / `glob` / `grep` and other inspection tools, and refuses writes, commands, and subagents |
| Shares the queue | While a turn runs, `/if` queues itself as an ordinary message in the composer's queue dock — editable, removable, steerable — and is judged when the turn opens; a `Yes` turns that very message into the instruction |
| Two queueing modes | `message` (default) shares the queue; `background` keeps the 0.2.x behavior: the command returns at once and judges in a background task |
| Send only when true | Only `Yes` sends the instruction as a user message; `No` never wakes the main agent |
| Judgment stays out of context | Judging happens in a separate child session; no main-session event and no `agent.inject` |
| Command arguments stay out of history | `recordInput: false` keeps the condition and instruction out of the input history; only a failed judgement writes them into the log-only `command/run` `args`, which the "取回 /if" button reuses |
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
dsh-if@0.5.0
```

Equivalent CLI command:

```powershell
dsh plugin --profile desktop add dsh-if@0.5.0
```

### From GitHub

`lib/` is ready to run; no local build is required:

```text
https://github.com/TLEWA/dsh-if
```

Pin a tag or the release tarball:

```powershell
dsh plugin --profile desktop add github:TLEWA/dsh-if#v0.5.0
```

```text
https://github.com/TLEWA/dsh-if/releases/download/v0.5.0/dsh-if-0.5.0.tgz
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

The separator wins: once a lone `---` line is present, everything after it is the instruction.
So never put a lone `---` (a Markdown horizontal rule) inside the instruction body — anything
before it would be read as part of the condition.

### Judgment semantics

- The judge is the model configured for the current session, not a JavaScript or math
  evaluator. `1+1=2` is only a minimal example; conditions can be "has the user approved
  the plan?" or "did the previous reply contain an error?".
- Only the bare words `Yes` and `No` count as a verdict (case, surrounding quotes, and code
  fences are tolerated; nothing else is). Answers such as "成立", "否", "否则…", or "YES but the
  condition is false" are never guessed at.
- When the answer does not follow the contract, the same condition is asked again, up to
  `judgeRetries` more times (default 3; 0 disables retrying). Every attempt shares one 60-second
  judging budget. If no valid answer arrives, the command fails closed, sends nothing, and leaves
  an `【/if 未执行】` card (the original input stays recoverable through "取回 /if").
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
    judgeRetries: 3   # extra regenerations when the answer is not exactly Yes / No (0-5, 0 = never retry)
```

- `mode: message` (default): `/if` first queues itself as an ordinary user message and is judged
  when the turn actually opens. The entry is the literal `/if <condition>` plus the instruction and
  shows up in the queue dock above the composer, so editing it edits condition and instruction.
- `mode: background`: the 0.2.x behavior. The command returns "queued" at once and the judgement
  runs in a background task, outside the session queue. Because there is no queued entry to rewrite,
  a failed judgement is recorded as an `if` command card explaining why.

- `judgeRetries` (default 3, range 0-5): how many times to ask again when the judge does not answer
  exactly `Yes` or `No`; 0 means fail on the first invalid answer. Retries share the first attempt's
  60-second budget.

Both fields are volatile: the running plugin reads them on every judgement, so changing the config
needs no reload. **Plugins → dsh-if → Configure** has a "Judge mode" dropdown that rewrites the
running config; `judgeRetries` can also be set in the `cordis.patch.yml` block above (range 0-5).

The plugin exports a `Config` schema (`@deepseek-ai/schemastery`) describing that field; unknown
keys are ignored and a missing `mode` means `message`.

## How it works

1. `ctx.effect(() => ctx.commands.register(...))` registers `/if` with `recordInput: false`; the
   registration lives on the plugin fiber, so unloading the plugin also unregisters the command and
   re-enabling it never collides.
2. **Queueing.** In `message` mode the command immediately queues the literal
   `/if <condition>\n<instruction>` as an ordinary user message via `agent.followup()`. It lands in
   the host's durable inbox, so the queue dock shows it and can edit / remove / steer it, and the
   composer is never held by the command.
3. **Interception at the turn boundary.** When the turn opens, the host claims that batch through
   the `agent/pre-step` waterfall; the plugin takes the claimed messages, picks the ones starting
   with `/if`, and judges them in place — the literal `/if` line never reaches the model history.
   On `YES` the message's content is replaced by the instruction; on `NO` the message is dropped.
   If the judgement fails (timeout, unparseable output, the child cannot start), the entry is
   dropped too and an `【/if 未执行】` error command card is logged (`command/run` +
   `command/done`, log-only, never part of a model request) that names the reason and keeps the
   original input for the "取回 /if" button on the right of that card. The card is logged after
   the turn's `turn/end`, so it stays at the top level instead of being folded into the collapsed
   turn-process group. When the dropped `/if` leaves nothing but plugin-injected context in the
   batch, the interception rejects it (`{ kind: 'reject' }`) so the turn ends: a failed `/if` never
   costs the main model a request, and never disappears without a trace.
4. **Preferred path: a forked judge.** It resolves `ctx.subagents.getProvider('fork')`
   (requiring `inheritsParentContext === true`) and starts the child with
   `startActivation({ provider: 'fork', childId, request: { parent, agentOptions, prompt }, delivery: 'caller' })`.
   The request adds only one trailing user message (judging rules + condition); tools, system
   prompt, and history are inherited verbatim, so the prefix matches the main session's next request.
5. **Inherited work is dropped.** The fork seed is the parent's log up to the last `turn/end`, and
   next-turn messages queued before that boundary — plus any next-step steering not yet claimed —
   fall inside it. A child would run those copies as its own turns first, so the verdict lands on
   the wrong turn and the steering even becomes judge work. The plugin therefore removes every
   pending item in both inbox queues except its own judge prompt when the child is created; the
   parent's queue is untouched.
6. **Read-only at execution time.** The child inherits the full tool catalog, but a
   `ctx.tools.guard` guard — scoped to judge children only — allows `read` / `glob` / `grep` /
   `web_search` / `web_fetch` / `skill` and refuses every mutating or executing tool. The tool
   catalog is not filtered, so the cached prefix is unaffected.
7. The judge times out after 60 seconds (retries share that budget). Only on `Yes` the instruction is handed to the main agent
   as an identified user message with `id` and `role: 'user'`. On `NO`, the queued message is
   dropped and the main agent is not touched.
8. **Fallback path.** When the host has no prefix-inheriting fork provider, `historyTranscript()`
   reads `agent.session.deriveMessages()`, keeps only user / assistant / tool messages, and
   builds a plain-text transcript of at most ~24k characters (each message clipped to 3k
   characters, keeping head and tail). One `ctx.llm.stream()` call then judges it. That request
   carries no main-session `sessionId`, so it cannot hit the main cache; it exists for
   compatibility only.
9. **`background` mode** skips steps 2–3: the command hands the judgement to a serial background
   chain and returns "queued" immediately. The verdict is delivered with `agent.followup` — the
   instruction on `YES`, an `【/if 未执行】` command card on failure — and several `/if` commands
   judge in send order.

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

- Verified on DSH `0.2.1-rc.5` and `0.2.2-rc.1`, Windows desktop;
- The judge's fork activation supports both the nested `request` signature used by
  `0.2.2-rc.1` and earlier and the flat `0.2.2-rc.2` signature; the shape is selected from
  the host's `resolveName` / `drainDescendants` capabilities. The rc.2 host is not published
  yet, so this round covers it with contract tests and real-host regression follows;
- Since 0.2.2 the host fixes the step's model before pre-step: the judge uses that step's
  `modelSelection` or `agent.model.current()`, and pins the same route into the forked judge.
  On 0.2.1, which has neither API, it falls back to the request header and `agent.options` —
  the previous behaviour;
- Uses the public `@deepseek-ai/dsh-commands` registration API;
- Prefers the `ctx.subagents` `fork` provider plus `ctx.tools.guard`, and falls back to
  `ctx.llm.stream` when the host does not provide them;
- No client bundle and no build step.

## Tests

```powershell
npm test
npm run test:slow
```

`npm test` explicitly includes the slow test
`a provider that ignores abort cannot park the judge forever` and uses
`DSH_IF_TEST_FAST_JUDGE=1` to shorten only that run's deadline to 150ms; `npm run test:slow`
has no such flag and still waits out the real 60s product contract. The entry passes an explicit
file list so Node 24's test-file discovery cannot spawn a separate isolated child.

The tests use mocked `ctx.commands`, `ctx.llm`, `ctx.subagents`, `ctx.tools`, and `agent`, and cover:

- registration and `recordInput: false`
- the forked judge adding exactly one trailing message, clamping `agentOptions.maxTokens`, and
  disposing the child session
- `YES` sends exactly the instruction; `NO` sends nothing
- tool-call markup in the judge output is stripped; output like `MAYBE` fails closed
- the guard only covers judge children: `write` / `pwsh` are refused, `read` / `grep` pass,
  other sessions are untouched, and ownership is released after the child's dispose completes
- the forked child drops work inherited from the parent's queue — both `nextTurn` and `nextStep` —
  and keeps only its judge prompt
- `mode: message`: the command turns itself into an ordinary queued message; the turn boundary
  replaces `/if` with the instruction, drops it on `NO`, and leaves ordinary messages alone
- `mode: background`: returns "queued" at once, judges asynchronously, keeps send order
- falling back to the transcript judge when no prefix-inheriting provider exists, and never
  using a non-inheriting provider
- a failing fork activation falls back to the transcript judge; when both fail, an `【/if 未执行】`
  command card is logged instead of silently dropping the message, and the main model is never
  asked about the failed condition
- the judge deadline still ends the wait when the provider ignores `AbortSignal`; the default
  entry injects 150ms, while `test:slow` exercises the real 60s wait
- a `background` turn-wait timeout leaves an `【/if 未执行】` card instead of only a log line
- a cancellation that lands after judging leaves an `【/if 未执行】` cancellation card per judged
  `/if` and never sends the instruction
- `---` multi-line conditions
- missing instruction / empty instruction
- filtering system / developer messages
- retry when `reasoningEffort` is unsupported
- judge prompt excludes the instruction; result text excludes the condition/verdict;
  a failed fork's output never reaches logs or cards
- the sent instruction carries `id` and `role: 'user'` so persisted sessions reload cleanly
- a fake turn loop (`test/loop.test.mjs`) replaying the host's claim order and empty-batch behavior:
  the instruction is committed before the step opens, `NO` opens no step, a failed judgement opens no
  step and leaves a command card
- the client half (`test/client.test.mjs`): settings read/write, a refused write is not shown as
  saved, loading is not reported as read-only, "取回 /if" (registered on
  `conversation.chat.commandview` under the `if` key) restores the command card's input, unload
  releases the subscription

## Privacy

- No telemetry, analytics, or third-party remote requests.
- The judge sends "existing session context + condition" to the model provider configured
  for the current session, over the same model channel as normal chat.
- Conditions and context may contain sensitive data; do not put anything into `/if` that
  you would not send to your model provider.
- Failure logs and cards carry only a generic reason. Only when `DSH_IF_DEBUG=1` is set does
  the log keep the truncated child error output (which may quote the condition; cards never do).

## Known limitations

- Judging is a real subagent turn: the desktop UI shows a subagent card on the session
  timeline (label `if judge`, with elapsed time, cost and token usage) until the judge is
  disposed. The main session gains no judge messages — that card belongs to the separate
  child session.
- A queued `/if` is a copy of an ordinary user message (`/if <condition>` + instruction). It is
  replaced by the instruction (YES) or dropped (NO) before the turn opens, so it never reaches model
  history; editing it edits both the condition and the instruction.
- When judging fails nothing is dropped silently and the main model is not bothered: the `/if` leaves
  the batch, and an `【/if 未执行】` command card (reason + expandable explanation) is logged in the
  session; "取回 /if" on the right of that card restores the original input for editing. `background`
  mode has no queued entry, so it logs the same card. A warning is logged as well.
- When a batch is cancelled after judging but before the instruction is sent, every judged `/if`
  leaves an `【/if 未执行】` card (reason "batch cancelled") and the instruction is not executed;
  a cancellation during judging records the whole batch as failed cards.
- The judge child's read-only guard stays armed until dispose completes. If dispose fails or
  takes longer than one second, a warning is logged and a read-only tombstone remains until it
  really finishes; the host turn is not parked by it.
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

## Other DSH projects I work on

`/if` is only one corner of DSH. These are the other plugins I maintain — take what fits.

- **[dsh-sidebar-row-menu](https://github.com/TLEWA/dsh-sidebar-row-menu)** — right-click menus for sidebar rows: workspace rows, session rows and the conversation body each get their own menu, with "Open with" and "More actions" submenus.
- **[dsh-sidebar-organizer](https://github.com/TLEWA/dsh-sidebar-organizer)** — a layout organizer for seven regions: sidebar, sidebar footer, conversation tabs, composer, session header, right panel, and settings navigation all support long-press drag to reorder, and panels can be tucked into "More".
- **[dsh-better-choice](https://github.com/TLEWA/dsh-better-choice)** — an `ask_user_question` enhancement: right-click an option to add a note, or ask the model a side question with the same context before choosing.
- **[dsh-utf8-output](https://github.com/TLEWA/dsh-utf8-output)** — fixes GBK/CP936/GB18030 mojibake from DSH subprocess output on Windows.
- **[dsh-opencode-go-router](https://github.com/TLEWA/dsh-opencode-go-router)** — rotates OpenCode Go routing after a context fold or a system-prompt rewrite, so less of the prompt cache is lost.
- **[dsh-fastload](https://github.com/TLEWA/dsh-fastload)** — trims the first history page of long sessions while preserving the tail the user actually sees.
- **[dsh-ptc-noargs](https://github.com/TLEWA/dsh-ptc-noargs)** — fixes rejected argument-less tool calls in PTC `run_code` by normalizing an omitted or `undefined` first argument to `{}`.

## License

[MIT](LICENSE)

## Codex PR review

This repository adopts the v1 shared review block in AGENTS.md from [central CI](https://github.com/TLEWA/dsh-plugin-ci). Cloud Codex reviews PRs and new commits; maintainers retain final approval and merging. Review results must cover the latest commit. Review consumes subscription usage; use `@codex review` for missing results.
