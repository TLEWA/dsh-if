import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apply } from '../lib/index.js';

/**
 * A fake turn loop that mirrors the parts of DSH's `ReactLoopAgent` this plugin
 * depends on:
 *
 * - `claim` takes every queued next-step message first, then one next-turn
 *   message, which is the order that made inherited steering dangerous;
 * - `agent/pre-step` is a waterfall whose default decision is "enter with the
 *   claimed batch";
 * - an empty batch ends the turn silently, without opening a step.
 *
 * The model is scripted, so the suite never spends an API call.
 */
function createLoop({ judge = 'YES', mode = 'message', judgeThrows, streamThrows = false, context } = {}) {
  const events = [];
  const appends = [];
  const handlers = new Map();
  const cleanups = [];
  // Mirrors the host's durable inbox projection: entries are addressed by id,
  // and `remove` rewrites the projection (see dropInheritedInbox).
  const inbox = {
    nextTurn: [],
    nextStep: [],
    remove(id) {
      for (const queue of [inbox.nextTurn, inbox.nextStep]) {
        const index = queue.findIndex((message) => message.id === id);
        if (index >= 0) queue.splice(index, 1);
      }
    },
  };
  const committed = [];
  const steps = [];
  let definition;
  let preStep;
  let turnSeq = 0;

  const ctx = {
    logger: { warn() {} },
    effect(fn) {
      const dispose = fn();
      if (typeof dispose === 'function') cleanups.push(dispose);
      return dispose;
    },
    commands: {
      register(value) {
        definition = value;
      },
    },
    tools: {
      guard() {
        return () => undefined;
      },
    },
    llm: {
      listProviders: () => [],
      listModels: async () => [],
      stream() {
        if (streamThrows) throw new Error('no route');
        return (async function* fake() {
          yield { type: 'text-delta', text: judge };
          yield { type: 'finish', reason: 'stop' };
        })();
      },
    },
    on(event, handler) {
      if (event === 'agent/pre-step') preStep = handler;
      handlers.set(event, handler);
      // A real unregister removes the waterfall link, which is exactly what
      // makes an unrewritten `/if` line reach the model after a dispose.
      return () => {
        if (preStep === handler) preStep = undefined;
        if (handlers.get(event) === handler) handlers.delete(event);
      };
    },
  };
  const emit = (event, ...payload) => {
    handlers.get(event)?.(...payload);
  };

  if (!streamThrows) {
    ctx.subagents = {
      getProvider: (id) => (id === 'fork' ? { id, inheritsParentContext: true } : undefined),
      async startActivation(options) {
        if (judgeThrows) throw judgeThrows;
        return {
          result: Promise.resolve({ stopReason: 'completed', output: [{ type: 'text', text: judge }] }),
          dispose: async () => undefined,
        };
      },
    };
  }

  apply(ctx, { mode });

  const agent = {
    id: 'session-1',
    options: { provider: 'p', model: 'm' },
    session: {
      requestHeader: () => ({ config: { provider: 'p', model: 'm' } }),
      deriveMessages: () => committed,
      snapshotEvents: () => events,
      append(type, data) {
        const event = { type, data, seq: events.length };
        events.push(event);
        appends.push(event);
        return event;
      },
    },
    inbox,
    followup(message) {
      inbox.nextTurn.push(message);
    },
    inject(message) {
      inbox.nextStep.push(message);
    },
  };

  const claim = () => {
    const batch = [...inbox.nextStep.splice(0, inbox.nextStep.length)];
    const next = inbox.nextTurn.shift();
    if (next !== undefined) batch.push(next);
    return batch;
  };

  return {
    agent,
    inbox,
    events,
    appends,
    steps,
    definition,
    /** Run every `ctx.effect` teardown, like unloading the plugin. */
    dispose() {
      for (const cleanup of cleanups.reverse()) cleanup();
    },
    /** Run one turn exactly like the loop: claim, waterfall, commit or end. */
    async runTurn() {
      const turn = (turnSeq += 1);
      const endTurn = (reason) => {
        const event = { type: 'turn/end', seq: events.length, turn, reason };
        events.push(event);
        emit('session/event', agent.session, event);
      };
      events.push({ type: 'turn/start', seq: events.length, turn });
      const batch = claim();
      // With the plugin unloaded the waterfall is gone, so the claimed batch
      // enters unmodified — the leak the dispose test guards against.
      const decision = preStep === undefined
        ? { kind: 'enter', messages: batch }
        : await preStep({ agent, messages: batch, turn, step: 0, signal: new AbortController().signal }, async () => ({
          kind: 'enter',
          // Mirrors the host's default handler: the turn's runtime context is
          // appended after the claimed batch.
          messages: context === undefined ? batch : [...batch, context],
        }));
      if (decision.kind === 'reject') {
        endTurn('blocked');
        return { turn, opened: false, messages: [] };
      }
      if (decision.messages.length === 0) {
        endTurn('completed');
        return { turn, opened: false, messages: [] };
      }
      steps.push({ turn, messages: decision.messages });
      committed.push(...decision.messages);
      endTurn('completed');
      return { turn, opened: true, messages: decision.messages };
    },
  };
}

const textOf = (message) => message.content.map((block) => block.text ?? '').join('\n');

function send(loop, rawInput) {
  return loop.definition.handler({ agent: loop.agent, rawInput, signal: new AbortController().signal });
}

test('a queued /if is judged and replaced before the step commits', async () => {
  const loop = createLoop({ judge: 'YES' });
  await send(loop, ' 文件是否已经改好\n请运行测试');

  // The queue holds the line verbatim, which is what the composer panel shows.
  assert.equal(loop.inbox.nextTurn.length, 1);
  assert.equal(textOf(loop.inbox.nextTurn[0]), '/if 文件是否已经改好\n请运行测试');

  const result = await loop.runTurn();

  assert.equal(result.opened, true, 'a YES verdict opens the step');
  assert.deepEqual(result.messages.map(textOf), ['请运行测试'], 'only the instruction is committed');
  assert.equal(loop.inbox.nextTurn.length, 0);
});

test('a NO verdict ends the turn without opening a step', async () => {
  const loop = createLoop({ judge: 'NO' });
  await send(loop, ' 条件\n秘密指令');

  const result = await loop.runTurn();

  assert.equal(result.opened, false);
  assert.equal(loop.steps.length, 0);
});

test('runtime context alone never opens a step after a dropped /if', async () => {
  // Regression: the host appends a runtime-context message to every batch, so a
  // dropped /if left the batch non-empty and the main model answered anyway.
  const context = {
    id: 'ctx',
    role: 'user',
    source: { kind: 'runtime-context' },
    content: [{ type: 'text', text: '[运行时上下文] 当前目录：C:\\work' }],
  };
  for (const [label, options] of [
    ['NO', { judge: 'NO' }],
    ['a failed judge', { judgeThrows: new Error('fork unavailable'), streamThrows: true }],
  ]) {
    const loop = createLoop({ ...options, context });
    await send(loop, ' 条件\n秘密指令');
    const result = await loop.runTurn();
    assert.equal(result.opened, false, `${label} must not buy a model request`);
    assert.equal(loop.steps.length, 0);
  }
});

test('a failed judge ends the turn without a model call, leaving a command card', async () => {
  const loop = createLoop({ judgeThrows: new Error('fork unavailable'), streamThrows: true });
  await send(loop, ' 条件\n秘密指令');

  const result = await loop.runTurn();
  // The card is logged after the turn closes, so it stays outside the folded
  // turn-process group.
  await new Promise((resolve) => setTimeout(resolve, 10));

  // Dropping the line leaves an empty batch, which the loop treats as a finished
  // turn: the main model is never called about a condition that failed. The
  // failure is visible as an error command card instead.
  assert.equal(result.opened, false, 'no step opens, so no model request');
  assert.equal(loop.steps.length, 0);
  const turnEnd = loop.events.find((event) => event.type === 'turn/end');
  const notices = loop.appends.filter((event) => event.type === 'command/done');
  assert.equal(notices.length, 1, 'the failure is recorded in the conversation');
  assert.equal(notices[0].data.kind, 'error');
  assert.match(notices[0].data.text, /^【\/if 未执行】/);
  assert.ok(notices[0].seq > turnEnd.seq, 'the card is logged outside the failed turn');
  const run = loop.appends.find((event) => event.type === 'command/run');
  assert.equal(run.data.args, '条件\n秘密指令', 'the original input stays recoverable');
});

test('steering queued for the next step is claimed before the queue line', async () => {
  // Mirrors the real claim order: next-step first, then one next-turn message.
  const loop = createLoop();
  loop.agent.inject({ id: 'steer', role: 'user', content: [{ type: 'text', text: '插一句' }] });
  await send(loop, ' 条件\n指令');

  const result = await loop.runTurn();
  // Both are claimed together, so the /if line is judged in the same batch and
  // the steering keeps its position; nothing is lost.
  assert.deepEqual(result.messages.map(textOf), ['插一句', '指令']);
});

test('disposing the plugin drops a queued /if line instead of leaking it', async () => {
  const loop = createLoop();
  await send(loop, ' 条件\n秘密指令');
  assert.equal(loop.inbox.nextTurn.length, 1);

  // Unloading (or disabling) the plugin removes the pre-step hook; a raw
  // `/if` line left in the durable inbox would then be handed to the main
  // model as ordinary user input, condition and instruction included.
  loop.dispose();

  assert.equal(loop.inbox.nextTurn.length, 0, 'the raw /if line must not survive the dispose');
  const result = await loop.runTurn();
  assert.equal(result.opened, false);
  assert.equal(loop.steps.length, 0);
});

test('disposing the plugin leaves ordinary queued messages alone', async () => {
  const loop = createLoop();
  await loop.agent.followup({ id: 'plain', role: 'user', content: [{ type: 'text', text: '普通消息' }] });
  await send(loop, ' 条件\n秘密指令');

  loop.dispose();

  assert.deepEqual(loop.inbox.nextTurn.map((message) => message.id), ['plain']);
});

test('a judged /if line is no longer tracked once the step takes it', async () => {
  const loop = createLoop({ judge: 'NO' });
  await send(loop, ' 条件\n秘密指令');
  await loop.runTurn();
  assert.equal(loop.inbox.nextTurn.length, 0);

  // Nothing is left for the dispose path to remove; it must stay a no-op.
  loop.dispose();
  assert.equal(loop.inbox.nextTurn.length, 0);
});
