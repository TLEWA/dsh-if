import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apply } from '../lib/index.js';

/**
 * Build a fake DSH host.
 *
 * `fork === undefined` means "the host has no fork subagent provider", which
 * exercises the transcript fallback. `fork: { text: 'YES' }` exercises the
 * preferred forked judge.
 */
function harness({
  answer = 'YES',
  messages = [],
  turns = [],
  stream,
  fork,
  forkThrows,
  forkInherits = true,
  inherited = [],
  config = { mode: 'background' },
} = {}) {
  let definition;
  let preStepHandler;
  const calls = [];
  const forks = [];
  const disposes = [];
  const guardDuringJudge = [];
  const childGuards = [];
  const events = [...turns];
  const effects = [];
  let childGuardReleased = false;
  let guard;
  let guardRelease;
  let createdHandler;
  let lastChildInbox;

  const ctx = {
    effect(fn) {
      effects.push(fn);
    },
    commands: {
      register(value) {
        definition = value;
      },
    },
    llm: {
      listProviders() {
        return [];
      },
      async listModels() {
        return [];
      },
      stream(options) {
        calls.push(options);
        if (stream !== undefined) return stream(options, calls.length);
        return (async function* fake() {
          yield { type: 'text-delta', text: answer };
          yield { type: 'finish', reason: 'stop' };
        })();
      },
    },
    tools: {
      guard(fn) {
        guard = fn;
        return () => {
          guardRelease = true;
        };
      },
    },
    on(event, handler) {
      if (event === 'agent/created') createdHandler = handler;
      if (event === 'agent/pre-step') preStepHandler = handler;
      return () => {
        if (createdHandler === handler) createdHandler = undefined;
        if (preStepHandler === handler) preStepHandler = undefined;
      };
    },
  };

  if (fork !== undefined) {
    ctx.subagents = {
      getProvider(id) {
        return id === 'fork' ? { id, inheritsParentContext: forkInherits } : undefined;
      },
      async startActivation(options) {
        if (!forkInherits) throw new Error('a non-inheriting provider must not be used');
        forks.push({ ...options, eventsAtStart: events.map((event) => `${event.type}:${event.seq}`) });
        // The parent log can carry queued next-turn messages inside the seeded
        // prefix; the child starts with those copied into its own inbox.
        const childInbox = {
          nextTurn: inherited.map((item) => ({
            id: item.id,
            role: 'user',
            content: [{ type: 'text', text: item.text }],
          })),
          removed: [],
          remove(id) {
            this.removed.push(id);
            this.nextTurn = this.nextTurn.filter((message) => message.id !== id);
          },
        };
        lastChildInbox = childInbox;
        const childAgent = {
          id: options.childId,
          session: { header: { id: options.childId } },
          inbox: childInbox,
          ctx: {
            tools: {
              guard(fn) {
                childGuards.push(fn);
                return () => {
                  childGuardReleased = true;
                };
              },
            },
          },
        };
        createdHandler?.({ agent: childAgent });
        // Tool calls from the judge child, right while it is judging. The guard
        // must refuse mutation and allow read-only inspection, like plan mode.
        guardDuringJudge.push({
          ownWrite: guard?.({ agent: childAgent, name: 'write', arguments: { file_path: 'x' } }),
          ownShell: guard?.({ agent: childAgent, name: 'pwsh', arguments: { command: 'echo hi' } }),
          ownRead: guard?.({ agent: childAgent, name: 'read', arguments: { file_path: 'x' } }),
          ownGrep: guard?.({ agent: { session: { header: { id: options.childId } } }, name: 'grep', arguments: {} }),
          foreign: guard?.({ agent: { id: 'another-session' }, name: 'write', arguments: {} }),
          // The child's own tool runtime gets the same read-only guard.
          childWrite: childGuards[0]?.({ agent: childAgent, name: 'edit', arguments: {} }),
          childRead: childGuards[0]?.({ agent: childAgent, name: 'glob', arguments: {} }),
        });
        if (forkThrows !== undefined) throw forkThrows;
        return {
          result: Promise.resolve({
            stopReason: 'completed',
            output: fork.text === undefined ? [] : [{ type: 'text', text: fork.text }],
          }),
          dispose: async () => {
            disposes.push(options.childId);
          },
        };
      },
    };
  }

  apply(ctx, config);

  const followups = [];
  const parentAgent = {
    options: { provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'high' },
    session: {
      deriveMessages() {
        return messages;
      },
      requestHeader() {
        return { config: { provider: 'deepseek-official', model: 'deepseek-flash' } };
      },
      snapshotEvents() {
        return events;
      },
    },
    followup(input) {
      followups.push(input);
    },
  };

  return {
    definition,
    calls,
    forks,
    disposes,
    followups,
    agent: parentAgent,
    events: () => events,
    pushEvent: (event) => events.push(event),
    guard: () => guard,
    guardDuringJudge,
    childGuardArmed: () => childGuards.length,
    childGuardReleased: () => childGuardReleased,
    childInbox: () => lastChildInbox,
    guardReleased: () => guardRelease === true,
    /** Run the loop's `agent/pre-step` waterfall over a claimed batch. */
    preStep(batch, { agent = parentAgent, signal = new AbortController().signal } = {}) {
      assert.equal(typeof preStepHandler, 'function', 'the plugin must register agent/pre-step');
      return preStepHandler({ agent, messages: batch, step: 0, signal }, async () => ({
        kind: 'enter',
        messages: batch,
      }));
    },
    dispose() {
      for (const fn of effects) {
        const cleanup = fn();
        if (typeof cleanup === 'function') cleanup();
      }
    },
  };
}

/** Poll until `fn()` is truthy; tests must never depend on a fixed delay. */
async function waitFor(fn, timeout = 3000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = fn();
    if (value) return value;
    if (Date.now() > deadline) throw new Error('timed out waiting for the queued judge');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** Mirrors the plugin's rule: a start that no later end has closed is open. */
function isTurnOpen(events) {
  let start = -1;
  let end = -1;
  events.forEach((event, index) => {
    const seq = typeof event.seq === 'number' ? event.seq : index;
    if (event.type === 'turn/start') start = Math.max(start, seq);
    if (event.type === 'turn/end') end = Math.max(end, seq);
  });
  return start >= 0 && start > end;
}

function invoke(h, rawInput) {
  return h.definition.handler({
    agent: h.agent,
    rawInput,
    signal: new AbortController().signal,
  });
}

test('registers /if with opt-out input logging', () => {
  const h = harness();
  assert.equal(h.definition.name, 'if');
  assert.equal(h.definition.recordInput, false);
  assert.equal(typeof h.definition.description, 'string');
});

// ---------------------------------------------------------------------------
// Preferred path: forked judge shares the main request prefix.
// ---------------------------------------------------------------------------

test('forked judge inherits the session and appends only the condition prompt', async () => {
  const messages = [
    { role: 'user', content: [{ type: 'text', text: '先前的用户消息' }] },
    { role: 'assistant', content: [{ type: 'text', text: '先前的助手消息' }] },
  ];
  const before = JSON.stringify(messages);
  const h = harness({ fork: { text: 'YES' }, messages });
  const result = await invoke(h, ' 文件是否已经改好\n请运行测试');

  assert.deepEqual(result, { kind: 'success', text: '条件成立，指令已作为用户消息发送。' });
  assert.equal(h.calls.length, 0, 'the forked judge must not open a second llm stream');
  assert.equal(h.forks.length, 1);

  const request = h.forks[0];
  assert.equal(request.provider, 'fork');
  assert.equal(request.delivery, 'caller');
  assert.equal(request.request.parent, h.agent);
  assert.deepEqual(request.request.agentOptions, { maxTokens: 1024 });
  assert.equal(request.request.prompt.length, 1, 'the only new content is one user message');
  assert.equal(request.request.prompt[0].type, 'text');
  assert.match(request.request.prompt[0].text, /文件是否已经改好/);
  assert.doesNotMatch(request.request.prompt[0].text, /请运行测试/);

  assert.equal(JSON.stringify(messages), before, 'history must stay untouched');
  assert.equal(h.followups.length, 1);
  assert.deepEqual(h.followups[0].content, [{ type: 'text', text: '请运行测试' }]);
  assert.deepEqual(h.disposes, [request.childId], 'the judge session is disposed after judging');
});

test('the forked judge drops work inherited from the parent queue', async () => {
  const h = harness({
    fork: { text: 'YES' },
    inherited: [
      // Appended before the parent's turn closed, so the fork seed carries it.
      { id: 'reminder-1', text: '[meow-memory-reflect] 记忆反思任务' },
      { id: 'judge-1', text: '【/if 条件判断】\n不是继承来的工作' },
    ],
  });
  const result = await invoke(h, ' 已经写完\n回复一句：好');

  assert.deepEqual(result, { kind: 'success', text: '条件成立，指令已作为用户消息发送。' });
  assert.deepEqual(h.childInbox().removed, ['reminder-1'], 'only the inherited work is dropped');
  assert.deepEqual(
    h.childInbox().nextTurn.map((message) => message.id),
    ['judge-1'],
    'the judge prompt itself stays queued',
  );
});

test('forked judge NO verdict does not send the instruction', async () => {
  const h = harness({ fork: { text: 'NO' } });
  const result = await invoke(h, ' 用户已经吃过饭\n请再点一份');

  assert.deepEqual(result, { kind: 'success', text: '条件不成立，未执行。' });
  assert.equal(h.followups.length, 0);
  assert.doesNotMatch(JSON.stringify(result), /已经吃过饭|再点一份/);
  assert.equal(h.disposes.length, 1);
});

test('a forked judge that answers in Chinese still yields a verdict', async () => {
  // The child inherits the parent's language, and a Chinese session answers
  // "是" / "不成立" even when the prompt asks for YES / NO.
  const yes = harness({ fork: { text: '是' } });
  assert.equal((await invoke(yes, ' 条件\n执行指令')).kind, 'success');
  assert.equal(yes.followups.length, 1);

  const no = harness({ fork: { text: '不成立' } });
  assert.deepEqual(await invoke(no, ' 条件\n执行指令'), { kind: 'success', text: '条件不成立，未执行。' });
  assert.equal(no.followups.length, 0);
});

test('forked judge output with tool-call markup still yields a verdict', async () => {
  const h = harness({ fork: { text: '<tool_call>{"name":"bash"}</tool_call>\nYES' } });
  const result = await invoke(h, ' 条件\n执行指令');

  assert.equal(result.kind, 'success');
  assert.equal(h.followups.length, 1);
});

test('forked judge output without YES/NO is an error', async () => {
  const h = harness({ fork: { text: 'MAYBE' } });
  const result = await invoke(h, ' 条件\n秘密指令');

  assert.equal(result.kind, 'error');
  assert.match(result.text, /未返回 YES\/NO/);
  assert.doesNotMatch(result.text, /秘密指令|MAYBE/);
  assert.equal(h.followups.length, 0);
  assert.equal(h.disposes.length, 1);
});

test('the tool guard keeps the judge child read-only, like plan mode', async () => {
  const h = harness({ fork: { text: 'YES' } });
  await invoke(h, ' 条件\n执行指令');

  const guard = h.guard();
  assert.equal(typeof guard, 'function');
  const childId = h.forks[0].childId;

  const seen = h.guardDuringJudge[0];
  for (const denied of [seen.ownWrite, seen.ownShell]) {
    assert.match(String(denied), /只读模式/, 'mutation and commands are refused');
  }
  assert.equal(seen.ownRead, undefined, 'read stays available');
  assert.equal(seen.ownGrep, undefined, 'grep stays available');
  assert.equal(seen.foreign, undefined, 'other sessions are untouched');
  assert.match(String(seen.childWrite), /只读模式/, 'the child tool runtime is armed too');
  assert.equal(seen.childRead, undefined);
  assert.equal(h.childGuardArmed(), 1);
  assert.equal(h.childGuardReleased(), true, 'the child guard is released when judging ends');

  // Ownership is released when the judge returns, so a stale child id can no
  // longer be attributed to this plugin.
  assert.equal(guard({ agent: { id: childId }, name: 'write' }), undefined);
  assert.equal(guard({ agent: undefined, name: 'write' }), undefined);
  assert.equal(guard({ agent: { id: childId } }), undefined);
});

test('a fork provider without prefix inheritance falls back to the transcript judge', async () => {
  const h = harness({ answer: 'YES', fork: { text: 'YES' }, forkInherits: false });
  const result = await invoke(h, ' 条件\n执行指令');

  assert.equal(result.kind, 'success');
  assert.equal(h.forks.length, 0, 'the non-inheriting provider is never used');
  assert.equal(h.calls.length, 1, 'the fallback transcript judge runs');
  assert.equal(h.followups.length, 1);
});

test('a failing fork activation surfaces as a judge error and disposes', async () => {
  const h = harness({ fork: { text: 'YES' }, forkThrows: new Error('fork unavailable') });
  const result = await invoke(h, ' 条件\n执行指令');

  assert.equal(result.kind, 'error');
  assert.match(result.text, /条件判断失败/);
  assert.match(result.text, /fork unavailable/);
  assert.equal(h.followups.length, 0);
});

// ---------------------------------------------------------------------------
// Queueing behind a running turn.
// ---------------------------------------------------------------------------

test('a busy session acknowledges at once, then judges the closed turn', async () => {
  const h = harness({ fork: { text: 'YES' }, turns: [{ type: 'turn/start', seq: 0 }] });

  const started = Date.now();
  const result = await invoke(h, ' 任务是否已经完成\n请继续下一步');

  // A running command keeps the composer blocked, so the handler must return
  // instead of parking on the turn boundary.
  assert.equal(result.kind, 'success');
  assert.match(result.text, /已排队/);
  assert.ok(Date.now() - started < 500, 'the handler must not wait for the turn');
  assert.equal(h.forks.length, 0, 'no judge while the turn is still running');

  h.pushEvent({ type: 'turn/end', seq: 1 });

  await waitFor(() => h.followups.length === 1);
  assert.equal(h.forks.length, 1);
  assert.ok(h.forks[0].eventsAtStart.includes('turn/end:1'), 'the judge starts only after the turn closed');
});

test('a queued judge still fires when the next turn starts immediately', async () => {
  const h = harness({ fork: { text: 'NO' }, turns: [{ type: 'turn/start', seq: 0 }] });
  await invoke(h, ' 条件\n执行指令');

  h.pushEvent({ type: 'turn/end', seq: 1 });
  h.pushEvent({ type: 'turn/start', seq: 2 });

  await waitFor(() => h.forks.length === 1);
  assert.ok(h.forks[0].eventsAtStart.includes('turn/end:1'), 'our turn closed before the judge started');
  assert.equal(h.followups.length, 0);
});

test('disposing the plugin drops a queued judge without judging', async () => {
  const h = harness({ fork: { text: 'YES' }, turns: [{ type: 'turn/start', seq: 0 }] });
  await invoke(h, ' 条件\n执行指令');

  h.dispose();
  h.pushEvent({ type: 'turn/end', seq: 1 });
  await new Promise((resolve) => setTimeout(resolve, 400));

  assert.equal(h.forks.length, 0);
  assert.equal(h.followups.length, 0);
});

test('an idle session is judged immediately', async () => {
  const h = harness({ fork: { text: 'YES' }, turns: [{ type: 'turn/start', seq: 0 }, { type: 'turn/end', seq: 1 }] });
  const result = await invoke(h, ' 条件\n执行指令');

  assert.equal(result.kind, 'success');
  assert.ok(h.forks[0].eventsAtStart.includes('turn/end:1'));
});

// ---------------------------------------------------------------------------
// Fallback path: one-shot request with a bounded text transcript.
// ---------------------------------------------------------------------------

test('fallback YES sends exactly the instruction as a user message', async () => {
  const h = harness({ answer: 'YES' });
  const result = await invoke(h, ' 1+1=2\n请回复 OK');

  assert.deepEqual(result, { kind: 'success', text: '条件成立，指令已作为用户消息发送。' });
  assert.equal(h.followups.length, 1);
  assert.equal(h.followups[0].role, 'user');
  assert.equal(typeof h.followups[0].id, 'string');
  assert.notEqual(h.followups[0].id, '');
  assert.deepEqual(h.followups[0].content, [{ type: 'text', text: '请回复 OK' }]);
  assert.deepEqual(h.followups[0].source, { kind: 'user' });

  const judgeOptions = h.calls[0];
  assert.equal(judgeOptions.reasoningEffort, 'off');
  assert.equal(judgeOptions.maxTokens, 64);
  const judgePrompt = judgeOptions.messages[0].content[0].text;
  assert.match(judgePrompt, /1\+1=2/);
  assert.doesNotMatch(judgePrompt, /请回复 OK/);
});

test('fallback judge call is isolated and leaves existing history untouched', async () => {
  const messages = [
    { role: 'user', content: [{ type: 'text', text: '先前的用户消息' }] },
    { role: 'assistant', content: [{ type: 'text', text: '先前的助手消息' }] },
  ];
  const before = JSON.stringify(messages);
  const h = harness({ answer: 'YES', messages });
  await invoke(h, ' 条件\n执行指令');

  // The judge must not carry the main session id, and it must not mutate the
  // messages that form the reusable prefix of the main request.
  assert.equal(h.calls[0].sessionId, undefined);
  assert.equal(JSON.stringify(messages), before);
  assert.equal(h.followups.length, 1);
});

test('--- separates a multi-line condition from the instruction', async () => {
  const h = harness({ answer: 'NO' });
  const result = await invoke(h, ' 用户说了 A\n并且说了 B\n---\n执行 C');

  assert.equal(result.kind, 'success');
  const judgePrompt = h.calls[0].messages[0].content[0].text;
  assert.match(judgePrompt, /用户说了 A\n并且说了 B/);
  assert.doesNotMatch(judgePrompt, /执行 C/);
  assert.equal(h.followups.length, 0);
});

test('message with no second line is rejected', async () => {
  const h = harness();
  const result = await invoke(h, ' 只有一个条件');
  assert.equal(result.kind, 'error');
  assert.match(result.text, /用法/);
  assert.equal(h.calls.length, 0);
  assert.equal(h.forks.length, 0);
  assert.equal(h.followups.length, 0);
});

test('empty instruction is rejected', async () => {
  const h = harness();
  const result = await invoke(h, ' 条件\n---');
  assert.equal(result.kind, 'error');
  assert.match(result.text, /指令不能为空/);
  assert.equal(h.calls.length, 0);
});

test('prior context is included, system and developer messages are not', async () => {
  const messages = [
    { role: 'system', content: [{ type: 'text', text: 'SECRET SYSTEM PROMPT' }] },
    { role: 'developer', content: [{ type: 'text', text: 'SECRET DEVELOPER' }] },
    { role: 'user', content: [{ type: 'text', text: '把文件改成红色' }] },
    { role: 'assistant', content: [{ type: 'text', text: '已经改好了' }] },
  ];
  const h = harness({ answer: 'YES', messages });
  await invoke(h, ' 文件是否已经改成红色\n请运行测试');

  const judgePrompt = h.calls[0].messages[0].content[0].text;
  assert.match(judgePrompt, /把文件改成红色/);
  assert.match(judgePrompt, /已经改好了/);
  assert.doesNotMatch(judgePrompt, /SECRET SYSTEM PROMPT|SECRET DEVELOPER/);
});

test('an unrecognised verdict is an error and does not send the instruction', async () => {
  const h = harness({ answer: 'MAYBE' });
  const result = await invoke(h, ' 条件\n秘密指令');

  assert.equal(result.kind, 'error');
  assert.match(result.text, /未返回 YES\/NO/);
  assert.doesNotMatch(result.text, /秘密指令|MAYBE/);
  assert.equal(h.followups.length, 0);
});

test('a provider without reasoningEffort support is retried once', async () => {
  const h = harness({
    stream(_options, callNumber) {
      return (async function* fake() {
        if (callNumber === 1) {
          const error = new Error('UNSUPPORTED_REASONING_EFFORT');
          error.code = 'UNSUPPORTED_REASONING_EFFORT';
          throw error;
        }
        yield { type: 'text-delta', text: 'YES' };
        yield { type: 'finish', reason: 'stop' };
      })();
    },
  });
  const result = await invoke(h, ' 条件\n执行指令');

  assert.equal(result.kind, 'success');
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[0].reasoningEffort, 'off');
  assert.equal(h.calls[1].reasoningEffort, undefined);
  assert.equal(h.followups.length, 1);
});

// ---------------------------------------------------------------------------
// Default mode: the /if line joins the composer's queue as a normal message.
// ---------------------------------------------------------------------------

test('by default the command queues itself as an ordinary user message', async () => {
  const h = harness({ fork: { text: 'YES' }, config: null });
  const result = await invoke(h, ' 条件\n执行指令');

  assert.deepEqual(result, { kind: 'success', text: '已排队：与普通消息同一队列，轮次开始时判断。' });
  assert.equal(h.forks.length, 0, 'queueing must not judge before the turn boundary');
  assert.equal(h.followups.length, 1);
  assert.equal(h.followups[0].role, 'user');
  assert.equal(h.followups[0].content[0].text, '/if 条件\n执行指令');
});

test('a claimed /if line is replaced by its instruction before the step opens', async () => {
  const h = harness({ fork: { text: 'YES' }, config: null });
  const normal = { id: 'm0', role: 'user', content: [{ type: 'text', text: '普通消息' }] };
  const queued = { id: 'm1', role: 'user', content: [{ type: 'text', text: '/if 文件是否已经改好\n请运行测试' }] };

  const decision = await h.preStep([normal, queued]);

  assert.equal(decision.kind, 'enter');
  assert.equal(decision.messages.length, 2);
  assert.equal(decision.messages[0], normal);
  assert.equal(decision.messages[1].id, 'm1');
  assert.deepEqual(decision.messages[1].content, [{ type: 'text', text: '请运行测试' }]);
  assert.equal(h.forks.length, 1);
  assert.match(h.forks[0].request.prompt[0].text, /文件是否已经改好/);
});

test('a NO verdict drops the queued line so the turn opens no step', async () => {
  const h = harness({ fork: { text: 'NO' }, config: null });
  const queued = { id: 'm1', role: 'user', content: [{ type: 'text', text: '/if 条件\n秘密指令' }] };

  const decision = await h.preStep([queued]);

  assert.equal(decision.kind, 'enter');
  assert.deepEqual(decision.messages, []);
  assert.doesNotMatch(JSON.stringify(decision), /秘密指令/);
});

test('an ordinary message is never judged at the turn boundary', async () => {
  const h = harness({ fork: { text: 'YES' }, config: null });
  const normal = { id: 'm0', role: 'user', content: [{ type: 'text', text: '顺便问一句' }] };

  const decision = await h.preStep([normal]);

  assert.deepEqual(decision.messages, [normal]);
  assert.equal(h.forks.length, 0);
});
