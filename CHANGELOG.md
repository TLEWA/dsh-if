# Changelog

All notable changes are documented here. This project follows
[Semantic Versioning](https://semver.org/).

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
