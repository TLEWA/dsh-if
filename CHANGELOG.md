# Changelog

All notable changes are documented here. This project follows
[Semantic Versioning](https://semver.org/).

## [0.3.0] - 2026-11-04

### Added

- `mode: message` (the new default): `/if` queues itself as an ordinary user message, so it shows
  up in the composer's queue dock and can be edited, removed, or steered like any other message.
  The literal `/if` line is judged at the turn boundary (`agent/pre-step`) and replaced by the
  instruction on `YES`, dropped on `NO`; it never reaches the model history.
- `mode: background`: the 0.2.x behavior, selectable through the plugin config
  (`- id: if-command` / `config: { mode: background }`).

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
