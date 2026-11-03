# Changelog

All notable changes are documented here. This project follows
[Semantic Versioning](https://semver.org/).

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
