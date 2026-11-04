import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apply } from '../lib/index.js';

/**
 * The judge deadline, end to end, with a provider that ignores AbortSignal.
 *
 * This sits in its own file because it has to outlast the real 60s deadline;
 * `npm test` skips it and `npm run test:slow` runs it. Everything else is
 * scripted, so it spends no API call — the stream simply never ends.
 */
test('a provider that ignores abort cannot park the judge forever', async () => {
  let definition;
  const appends = [];
  const warnings = [];
  let preStep;

  const ctx = {
    logger: { warn: (message) => warnings.push(String(message)) },
    effect() {},
    commands: { register: (value) => (definition = value) },
    tools: { guard: () => () => undefined },
    llm: {
      listProviders: () => [],
      listModels: async () => [],
      stream() {
        return (async function* stuck() {
          // Never yields, never finishes, ignores abort: only the deadline can
          // end the wait.
          await new Promise(() => {});
        })();
      },
    },
    on(event, handler) {
      if (event === 'agent/pre-step') preStep = handler;
      return () => undefined;
    },
  };
  apply(ctx, { mode: 'background' });

  const agent = {
    id: 'session-1',
    options: { provider: 'p', model: 'm' },
    session: {
      requestHeader: () => ({ config: { provider: 'p', model: 'm' } }),
      deriveMessages: () => [],
      snapshotEvents: () => [],
      append: (type, data) => {
        appends.push({ type, data });
        return { type, data, seq: appends.length };
      },
    },
    followup: () => {
      throw new Error('a failed judge must not reach the main model');
    },
  };

  const started = Date.now();
  const result = await definition.handler({
    agent,
    rawInput: ' 条件\n秘密指令',
    signal: new AbortController().signal,
  });
  assert.deepEqual(result, { kind: 'success', text: '已排队。' });

  const deadline = Date.now() + 90_000;
  while (appends.length === 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  const done = appends.find((event) => event.type === 'command/done');
  assert.ok(done, 'the failure is reported instead of hanging');
  const elapsed = Date.now() - started;
  assert.ok(elapsed >= 55_000, `the 60s deadline is in effect (waited ${elapsed}ms)`);
  assert.equal(done.data.kind, 'error');
  assert.match(done.data.text, /^【\/if 未执行】/);
  assert.match(done.data.text, /超时|timeout/i);
  assert.ok(warnings.length >= 1, 'the failure is logged too');
  assert.equal(preStep === undefined || typeof preStep === 'function', true);
});
