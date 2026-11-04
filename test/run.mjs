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

run({ concurrency: 1 });
