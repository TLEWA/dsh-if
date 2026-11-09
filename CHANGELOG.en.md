# Changelog

All notable changes are documented here. Versions follow [Semantic Versioning](https://semver.org/).

## [0.3.5] - 2026-11-06

### Fixed

- **Questions such as "is it true?" were read as affirmative.** The judge sometimes answered with a question-shaped conclusion; the parser now strips the question prefix first, checks negation before affirmation, accepts English YES/NO anywhere, and treats a bare "no" as negative unless it is part of a question. Added normalizeAnswer to strip code fences, quotes and "conclusion:" labels.
- **A long turn in one session blocked other sessions.** The background judge queue is now per-session (WeakMap), so a long turn only affects its own queue.
- **Judge timeouts could stack to twice the limit.** Fork and transcript paths now share one deadline; retries consume the remaining budget.
- **Fork failures hid their cause.** A child session ending with stopReason: error now reports the real error instead of "model returned no YES/NO".
- **The settings retry timer survived unload.** dispose now clears timers, sets a disposed flag and clears subscribers.
- **The settings dropdown showed a stale value.** The snapshot identity now includes value, not only status/writable/revision.

### Performance

- Turn-end waiting no longer scans all events every 250ms; turn/start and turn/end wake waiters immediately, with a 250ms-to-2s backoff fallback.
- Multiple /if commands in the same batch judge in parallel instead of serially.

### Cleanup

- Removed the unused client bound() helper and the card data-state attribute with no matching style.
- README now documents the actual behavior: recordInput: false keeps /if input out of history while preserving the text for retry after a failed judge.

## [0.3.4] - 2026-11-05

### Compatibility

- DSH 0.2.2-rc.1: judging now follows the main model route; route selection uses the current step modelSelection, then agent.model.current(), then the session fallback.

### Docs

- Documented the model-routing behavior and the fallback order.

## [0.3.3] - 2026-11-04

### Docs

- Clarified command behavior, retry semantics and settings descriptions.

## [0.3.2] - 2026-11-04

### Fixed

- Fixed command parsing edge cases around prefixed question forms.

## [0.3.1] - 2026-11-04

### Added

- Added clearer failure cards and retryable error reporting.

### Fixed

- Fixed a race between judge completion and card rendering.

## [0.3.0] - 2026-11-04

### Added

- Added the web settings panel and per-session queue isolation.

### Changed

- Reworked the judge flow around session transcripts and explicit deadlines.

### Fixed

- Fixed stale settings snapshots and timer leaks after unload.

## [0.2.4] - 2026-11-04

### Fixed

- Fixed a timeout-accounting bug in the fork judge path.

## [0.2.3] - 2026-11-04

### Fixed

- Fixed cancellation propagation when a judge is aborted.

### Known limits

- Some providers ignore abort signals; the deadline is the final guard.

## [0.2.2] - 2026-11-04

### Fixed

- Fixed model selection for the judge when the session has a pinned route.

## [0.2.1] - 2026-11-04

### Fixed

- Fixed answer normalization for quoted and labeled conclusions.

## [0.2.0] - 2026-11-04

### Added

- Added transcript-based judging and the /if command surface.

### Changed

- The command now queues like an ordinary user message.

## [0.1.0] - 2026-11-04

### Added

- First release of the /if command: an LLM judges a condition from prior context, then the instruction below it is sent as a user message.

### Compatibility

- Requires DSH >=0.2.1-rc.5 and Node >=20.3.
