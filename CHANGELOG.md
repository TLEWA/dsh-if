# Changelog

All notable changes are documented here. This project follows
[Semantic Versioning](https://semver.org/).

## [0.3.2] - 2026-11-04

### Fixed

- **Re-enabling the plugin failed with `command "if" is already registered`.** The command was
  registered directly on the context instead of through `ctx.effect`, so unloading the plugin left
  the registration behind in the host's command service and the next activation collided with it.
  The registration now lives in the plugin fiber and is released on unload.

## [0.3.1] - 2026-11-04

### Added

- A failed judgement is no longer silent, and no longer reaches the main model. The `/if` entry is
  dropped (and the batch rejected when nothing else remains) so the turn ends without a request, and
  the failure is logged as an `【/if 未执行】` error command card (`command/run` + `command/done`,
  log-only, written after `turn/end` so it is not folded into the collapsed turn-process group) that
  carries the failure reason and the original input; a "取回 /if" button on the right of that card
  (registered on `conversation.chat.commandview` under the `if` key) puts that input back into the
  composer in one click. `background` mode logs the same card.
- `test/loop.test.mjs`: a fake turn loop that mirrors the host's claim order and empty-batch
  behavior, so the user-visible flow is covered without an API call.
- `test/client.test.mjs`: an in-process client harness (mini React, fake slots, fake `configForms`).
- `npm run test:slow` for the "provider ignores AbortSignal" deadline case.

### Fixed

- **Silent message loss.** When the judge threw or returned an unparseable verdict, the `/if` entry
  was dropped and the turn ended without any reply; the queued message simply vanished. It is now
  reported as a visible, recoverable command card instead of a message the model would answer.
- **The judge could hang forever.** The 60s timeout only aborted a signal, so a provider that
  ignored it kept the turn parked. Starting the fork, awaiting its result, and reading the
  transcript stream are now all bounded by a real deadline, and a forked judge that fails to start
  falls back to the transcript judge instead of failing the command.
- **Inherited `next-step` work.** A forked judge also inherited queued steering from the parent,
  which the host claims before next-turn messages, so the judge ran the parent's pending steer.
  Both inbox queues are now cleaned when the child appears.
- **A refused settings write looked saved.** `ConfigForms.mutate()` resolves `false` when the host
  refuses a write; the card treated any resolution as success and showed "已保存". Refusals now show
  "未保存" and the dropdown reflects the real value.
- **Background judges could reorder.** Several `/if` commands woken at the same turn end judged
  concurrently; they now run on one serial chain in send order.
- Client cleanup: the settings mirror subscription is disposed on unload, and the load retry chain
  actually retries instead of stopping after the first `rebind()`.
- The settings card says "加载中…" while the profile loads instead of claiming it is read-only.
- Background mode queues and returns at once instead of judging synchronously in the command
  handler (which could block for up to 60 seconds).

## [0.3.0] - 2026-11-04

### Added

- `mode: message` (the new default): `/if` queues itself as an ordinary user message, so it shows
  up in the composer's queue dock and can be edited, removed, or steered like any other message.
  The literal `/if` line is judged at the turn boundary (`agent/pre-step`) and replaced by the
  instruction on `YES`, dropped on `NO`; it never reaches the model history.
- `mode: background`: the 0.2.x behavior, selectable through the plugin config
  (`- id: if-command` / `config: { mode: background }`).
- A settings card (**Plugins → dsh-if → Configure**) with a "judge mode" dropdown. `mode` is a
  volatile field, so switching applies to the running host immediately, without a restart.

### Changed

- The mode is read on every use instead of once at load, so a settings change takes effect at once.
- The command no longer prints implementation details when queueing: `message` mode returns a plain
  success (the queued message is the feedback) and `background` mode returns "已排队。".

### Fixed

- A forked judge no longer runs work inherited from the parent queue. The fork seed covers the
  parent log up to the last `turn/end`, so next-turn messages queued just before that boundary
  were copied into the child, which executed them as its own turns — the verdict then landed on
  the wrong turn and the real instruction was dropped. Inherited pending items are now removed
  when the child is created.

## [0.2.4] - 2026-11-04

### Fixed

- The forked judge inherits the parent session's language, so a Chinese session answers
  "是" / "不成立" even though the prompt asks for YES / NO; that surfaced as
  "条件判断失败：模型未返回 YES/NO". Both spellings are now accepted, with negative forms
  matched first so "不成立" is never read as "成立".

## [0.2.3] - 2026-11-04

### Fixed

- The queued judge no longer runs inside the command handler. A command that is still
  executing keeps the composer blocked, so parking for a whole turn made the input box
  unusable. The handler now acknowledges immediately ("queued") and the judgement waits
  in the background; the running turn's token count is unchanged.

### Known limitation

- A queued `/if` cannot appear in the composer's queued-message panel: slash commands are
  dispatched immediately by the client, and plugins cannot enqueue into that outbox.

## [0.2.2] - 2026-11-04

### Fixed

- The queueing wait used an unref'd timer, so a process with no other pending work
  (notably `node --test` on Node 20) could exit while the command was still waiting.
  The timer is now ref'd; behaviour on a live host is unchanged.

## [0.2.1] - 2026-11-04

Queue the judgment behind a turn that is already running.

### Fixed

- `/if` entered while the model was working judged a stale context: the command is dispatched
  immediately, but a fork child inherits history only up to the previous `turn/end`, so the
  running turn's work was invisible and the condition was answered `NO`. The command now reads
  `session.snapshotEvents()` and waits for the open turn to close (up to 30 minutes) before
  judging, then delivers against the finished context — the same queueing a normal message gets.

## [0.2.0] - 2026-11-04

Judge with the parent session's own request prefix, and keep it read-only.

### Added

- The condition is now judged by a **forked subagent** (`ctx.subagents`, provider `fork`):
  tools, system prompt, and message history are inherited verbatim and the judge adds only one
  trailing user message. The prefix is byte-identical to the main session's next request, so the
  provider's prompt cache / KV cache is reused instead of re-paying for the whole context.
- An execution-time tool guard (`ctx.tools.guard`) keeps the judge read-only: `read`, `glob`,
  `grep`, `web_search`, `web_fetch`, `skill` and other inspection tools are allowed; writes,
  edits, commands, jobs, and subagents are refused. The tool catalog is never filtered — the
  same trade-off DSH plan mode makes for request-cache stability.
- Automatic fallback to the previous one-shot transcript judge when the host exposes no
  prefix-inheriting `fork` provider.

### Changed

- Judge timeout raised from 30s to 60s; the forked judge gets a 1024-token output budget per turn
  so a read call plus the verdict fit.
- `inject` now declares `subagents` and `tools` in addition to `commands` and `llm`.

## [0.1.0] - 2026-11-04

First public release.

### Added

- `/if` slash command: the first line is a condition, the remaining lines are an
  instruction; a lone `---` line separates a multi-line condition.
- A separate LLM judge reads prior user / assistant / tool messages and returns
  `YES` or `NO`; only `YES` sends the instruction as a user message.
- Context isolation: the command, condition, instruction, judge prompt, and verdict
  never enter the main agent's context.
- KV-cache safety: `NO` changes nothing; `YES` only appends one user message at the
  tail via `agent.followup`, leaving the existing prefix byte-identical.
- `recordInput: false`, so even log-only command events omit condition and instruction.
- Fail-closed handling for empty input, unrecognized verdicts, provider errors, and a
  30-second timeout.
- Identification-safe followup messages (`id` + `role: 'user'`) so persisted sessions
  reload without `lacks an identified message`.
- Chinese and English documentation, unit tests, CI, and tag-based GitHub releases.

### Compatibility

- DSH `0.2.1-rc.5` or newer.
- Node.js `20.3` or newer.
