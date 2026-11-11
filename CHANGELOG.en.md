# Changelog

All notable changes are documented here. Versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

- **Dispose no longer deletes a queued line the user edited.** The queue panel can turn `/if …` into an
  ordinary message in place, keeping its id; the unload cleanup now only removes an entry that still
  carries the exact `/if` text it queued, and leaves edited input for the main model.
- **A negative verdict was read as YES.** When the judge answered "尚未成立", "未满足",
  "是错误的" or "YES，但条件并不成立", the old parser matched the positive word inside the
  sentence and sent the instruction; conversely "否则不需要执行" was read as a bare "否" and
  silently treated as NO. Negation now goes through `isNegativeVerdict()` first, and a bare
  "否" only counts as its own word or as the opening of the sentence.
- **Queued /if lines leaked to the main model on unload.** In message mode `/if …` is first
  queued as an ordinary user message and rewritten by `agent/pre-step`; if the plugin was
  disabled or unloaded before that, the old code only aborted the background judgment and the
  raw line reached the main model as normal input. The queued message id is now tracked, dropped
  once the line is rewritten or discarded, and removed from the session inbox on unload (skipped
  when the host has no such API).

## [0.4.0] - 2026-11-11

- Adopt shared Codex PR review rules and repository-specific review guidance; preserve existing CI, human approval, and release behavior.

### Fixed

- **Cancellation swallowed already-judged /if entries.** When the batch was cancelled after
  judging finished but before the instruction was sent, the old code only threw, losing the
  judged entries and the user's input. Each judged `/if` now leaves an
  `【/if 未执行】` card saying it was cancelled and not executed; the original input can still
  be recovered from the card, and a cancelled instruction is never sent.
- **The judge child's read-only guard lapsed after release.** Teardown used to release
  ownership and then fire-and-forget dispose, so the same child could write while disposal was
  still running. Now dispose is awaited (up to one second) before release; a failed or timed-out
  dispose keeps a read-only tombstone with a warning and releases once it really finishes, without
  parking the host turn.
- **Fork failures copied the child output into warnings.** When the child ended with
  `stopReason: 'error'`, the truncated output was used as the failure reason and could contain the
  condition text. It now reports a generic "judge failed"; only `DSH_IF_DEBUG=1` logs the
  truncated detail (never in the card).
- **A turn-wait timeout only logged a warning.** In `background` mode, waiting 30 minutes for
  `turn/end` used to end with a log line and no user-visible notice. It now records an
  `【/if 未执行】` card immediately, explaining the timeout; the turn is never judged later.

### Tests

- **The slow test was not in the default entry.** `test/run.mjs` imported only three suites,
  leaving `slow.test.mjs` to Node's implicit discovery; Node 24 spawned an isolated child for it,
  hid the result, and kept the entry around 65s. The slow test is now imported explicitly with its
  name reported, and `DSH_IF_TEST_FAST_JUDGE=1` shortens only that run's deadline to 150ms;
  `npm run test:slow` still verifies the real 60s contract, and the default entry drops to ~3s.

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
