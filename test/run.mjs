/**
 * In-process test runner.
 *
 * `node --test test/` spawns one child per file, and spawned children cannot
 * pipe stdio under DSH's file sandbox (`spawn EPERM`). Importing the suites in
 * one process runs exactly the same `node:test` assertions without spawning
 * anything, so `npm test` works in the sandbox and on a plain machine alike.
 */
import { run } from 'node:test';

await import('./if.test.mjs');
await import('./loop.test.mjs');
await import('./client.test.mjs');

// The slow suite is part of the default run too: leaving it to Node's implicit
// file discovery hid its result and made the entry wait on a spawned,
// process-isolated child. Import it explicitly with a shortened judge deadline
// so the real 60s contract stays available via `npm run test:slow`.
process.env.DSH_IF_TEST_FAST_JUDGE = '1';
try {
  await import('./slow.test.mjs');
} finally {
  delete process.env.DSH_IF_TEST_FAST_JUDGE;
}

// An explicit empty file list keeps Node from discovering test files on its
// own (Node 24 defaults to process isolation, which spawned a child per file
// and stalled this in-process runner).
run({ concurrency: 1, files: [] });
