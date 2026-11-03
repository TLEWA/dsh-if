import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apply } from '../lib/index.js';

function harness({ answer = 'YES', messages = [], stream } = {}) {
  let definition;
  const calls = [];
  const ctx = {
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
  };
  apply(ctx);

  const followups = [];
  const agent = {
    options: { provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'high' },
    session: {
      deriveMessages() {
        return messages;
      },
      requestHeader() {
        return { config: { provider: 'deepseek-official', model: 'deepseek-flash' } };
      },
    },
    followup(input) {
      followups.push(input);
    },
  };

  return { definition, calls, followups, agent };
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

test('YES sends exactly the instruction as a user message', async () => {
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

test('judge call is isolated and leaves existing history untouched', async () => {
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

test('NO does nothing and never leaks the condition or judge output', async () => {
  const h = harness({ answer: 'NO' });
  const result = await invoke(h, ' 用户已经吃过饭\n请再点一份');

  assert.deepEqual(result, { kind: 'success', text: '条件不成立，未执行。' });
  assert.equal(h.followups.length, 0);
  assert.doesNotMatch(JSON.stringify(result), /已经吃过饭|再点一份/);
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
