import { test } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Minimal React stand-in.
 *
 * The client half is a chunk evaluated by DSH's browser loader: it only needs
 * `createElement`, `useState` and `useSyncExternalStore`. Rendering it for real
 * would drag in a DOM, so the components are invoked as plain functions and the
 * hook cells are kept per component instance — re-rendering is just another
 * call, which is exactly what these three hooks reduce to.
 */
function createRenderer() {
  const cellsByComponent = new WeakMap();

  const React = {
    createElement(type, props, ...children) {
      return { type, props: { ...(props ?? {}), children: children.length === 1 ? children[0] : children } };
    },
    useState(initial) {
      const cells = React.__cells;
      const index = React.__index++;
      if (cells[index] === undefined) cells[index] = typeof initial === 'function' ? initial() : initial;
      return [
        cells[index],
        (next) => {
          cells[index] = typeof next === 'function' ? next(cells[index]) : next;
        },
      ];
    },
    useSyncExternalStore(_subscribe, getSnapshot) {
      React.__index += 1;
      return getSnapshot();
    },
  };

  /** Call a component with persistent hook cells, and return its element tree. */
  const render = (Component, props) => {
    React.__cells = cellsByComponent.get(Component) ?? [];
    cellsByComponent.set(Component, React.__cells);
    React.__index = 0;
    return Component(props);
  };

  return { React, render };
}

/** Flatten an element tree into its text. */
function textOf(node) {
  if (node === null || node === undefined || node === false) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  return textOf(node.props?.children);
}

/** Depth-first search of the element tree. */
function findTree(node, predicate, found = []) {
  if (node === null || node === undefined || typeof node !== 'object') return found;
  if (Array.isArray(node)) {
    for (const child of node) findTree(child, predicate, found);
    return found;
  }
  if (predicate(node)) found.push(node);
  findTree(node.props?.children, predicate, found);
  return found;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Load the browser half through a fake `window.__ModuleLoader__`, like DSH's
 * client loader does: the chunk registers itself, then the loader calls the
 * factory with its `require` map.
 */
async function loadClient() {
  const { React, render } = createRenderer();
  const loaded = [];
  globalThis.window = {
    __ModuleLoader__: {
      load(definition) {
        loaded.push(definition);
      },
    },
  };
  // A fresh module instance per test: the chunk is a side-effecting script, so
  // Node's module cache would otherwise keep the first fake `window`.
  loadClient.instances = (loadClient.instances ?? 0) + 1;
  const url = new URL('../lib/client.js', import.meta.url);
  url.search = `?instance=${loadClient.instances}`;
  await import(url.href);
  assert.equal(loaded.length, 1, 'the chunk registers exactly one module');
  const definition = loaded[0];
  assert.equal(definition.id, 'dsh-if');
  const exports = definition.factory((id) => {
    if (id === 'react') return React;
    throw new Error(`unexpected require: ${id}`);
  });
  return { exports, render };
}

/** A fake `slots` registry: `inject` runs its factory, like a live slot. */
function createSlots() {
  const registry = [];
  const injected = [];
  return {
    registry,
    injected,
    register(options, Component) {
      const entry = { name: options.name, options, Component };
      registry.push(entry);
      return () => registry.splice(registry.indexOf(entry), 1);
    },
    inject(name, factory) {
      injected.push(name);
      const dispose = factory();
      return typeof dispose === 'function' ? dispose : () => undefined;
    },
    component(name) {
      return registry.find((entry) => entry.name === name);
    },
  };
}

/** A fake `configForms` service over one namespace. */
function createForms({ status = 'ready', writable = true, mode = 'message', mutate = async () => true } = {}) {
  const view = { mode };
  let revision = 1;
  const form = {
    getSnapshot: () => ({ status, writable, value: { ...view }, revision }),
    subscribe: () => () => undefined,
    mutate: (ops) =>
      Promise.resolve(mutate(ops)).then((accepted) => {
        if (accepted === false) return false;
        for (const op of ops) if (op.path?.[0] === 'mode') view.mode = op.value;
        // The Host bumps the revision with every accepted write; the client's
        // snapshot cache keys on it.
        revision += 1;
        return true;
      }),
  };
  return {
    describe: () => ({
      getSnapshot: () => ({ status: 'ready', view: { writable, hasDocument: true, namespaces: [{ ns: 'if-command' }] } }),
      subscribe: () => () => undefined,
      load: async () => undefined,
    }),
    get: () => form,
    view,
  };
}

/** Run `apply` against a fake client context and activate its effects. */
function applyClient(exports, { slots, forms }) {
  const cleanups = [];
  const scope = {
    get: (id) => (id === 'configForms' ? forms : undefined),
    effect(fn) {
      const dispose = fn();
      if (typeof dispose === 'function') cleanups.push(dispose);
    },
  };
  const ctx = {
    slots,
    inject(keys, callback) {
      assert.deepEqual(keys, ['configForms']);
      callback(scope);
    },
  };
  exports.apply(ctx);
  return {
    dispose() {
      for (const dispose of cleanups.reverse()) dispose();
    },
  };
}

// ---------------------------------------------------------------------------
// Settings row.
// ---------------------------------------------------------------------------

test('the settings row draws the live Host value and saves through mutate', async () => {
  const { exports, render } = await loadClient();
  const slots = createSlots();
  const forms = createForms({ mode: 'background' });
  applyClient(exports, { slots, forms });

  const entry = slots.component('plugins.row.config');
  assert.ok(entry, 'the settings row is registered');
  const face = entry.options.inject();
  let tree = render(entry.Component, { view: 'full', scope: face.scope });

  const select = findTree(tree, (node) => node.type === 'select')[0];
  assert.equal(select.props.value, 'background');
  assert.equal(select.props.disabled, false);

  select.props.onChange({ target: { value: 'message' } });
  await settle();
  tree = render(entry.Component, { view: 'full', scope: face.scope });

  assert.equal(findTree(tree, (node) => node.type === 'select')[0].props.value, 'message');
  assert.match(textOf(tree), /已保存/);
  assert.equal(forms.view.mode, 'message');
});

test('a Host that refuses the write is reported instead of a false 已保存', async () => {
  const { exports, render } = await loadClient();
  const slots = createSlots();
  const forms = createForms({ mode: 'message', mutate: async () => false });
  applyClient(exports, { slots, forms });

  const entry = slots.component('plugins.row.config');
  const face = entry.options.inject();
  let tree = render(entry.Component, { view: 'full', scope: face.scope });
  findTree(tree, (node) => node.type === 'select')[0].props.onChange({ target: { value: 'background' } });
  await settle();
  tree = render(entry.Component, { view: 'full', scope: face.scope });

  const text = textOf(tree);
  assert.doesNotMatch(text, /已保存/, 'a refused write must never read as saved');
  assert.match(text, /未保存/);
  assert.equal(forms.view.mode, 'message', 'the value did not change');
});

test('a loading profile says it is loading rather than read-only', async () => {
  const { exports, render } = await loadClient();
  const slots = createSlots();
  const forms = createForms({ status: 'loading', writable: false });
  applyClient(exports, { slots, forms });

  const entry = slots.component('plugins.row.config');
  const face = entry.options.inject();
  const tree = render(entry.Component, { view: 'full', scope: face.scope });

  assert.match(textOf(tree), /加载中/);
  assert.doesNotMatch(textOf(tree), /不接受写入/);
});

// ---------------------------------------------------------------------------
// Command card: take the failed `/if` back, right where the failure is shown.
// ---------------------------------------------------------------------------

/** The command payload the Host hands a `conversation.chat.commandview` entry. */
function commandNode({ args = '条件\n秘密指令', outcomeKind = 'error', name = 'if', text = '【/if 未执行】条件判断失败。' } = {}) {
  return { name, args, outcome: outcomeKind === null ? null : { kind: outcomeKind, text } };
}

test('the failure card offers the failed /if back in one click', async () => {
  const { exports, render } = await loadClient();
  const slots = createSlots();
  applyClient(exports, { slots, forms: createForms() });

  const entry = slots.component('conversation.chat.commandview');
  assert.ok(entry, 'the /if card is registered for the command view slot');

  const inserted = [];
  const inputActions = {
    captureInsertion: () => ({ revision: 7 }),
    insertText: (text, span) => {
      inserted.push({ text, span });
      return true;
    },
  };

  let tree = render(entry.Component, { node: commandNode(), inputActions });
  const button = findTree(tree, (node) => node.type === 'button')[0];
  assert.ok(button, 'the button appears on a failed /if card');
  assert.match(textOf(button), /取回 \/if/);
  assert.match(textOf(tree), /if/, 'the card still names the command');

  button.props.onClick({ stopPropagation() {} });
  assert.deepEqual(inserted, [{ text: '/if 条件\n秘密指令', span: { revision: 7 } }]);

  tree = render(entry.Component, { node: commandNode(), inputActions });
  assert.match(textOf(tree), /已放回输入框/);
});

test('the card reports a busy composer and keeps the button', async () => {
  const { exports, render } = await loadClient();
  const slots = createSlots();
  applyClient(exports, { slots, forms: createForms() });
  const entry = slots.component('conversation.chat.commandview');

  const inputActions = {
    captureInsertion: () => ({ revision: 7 }),
    insertText: () => false,
  };
  let tree = render(entry.Component, { node: commandNode(), inputActions });
  findTree(tree, (node) => node.type === 'button')[0].props.onClick({ stopPropagation() {} });

  tree = render(entry.Component, { node: commandNode(), inputActions });
  assert.match(textOf(tree), /输入框正忙/);
  assert.equal(findTree(tree, (node) => node.type === 'button').length, 1);
});

test('the button only appears on a failed /if card', async () => {
  const { exports, render } = await loadClient();
  const slots = createSlots();
  applyClient(exports, { slots, forms: createForms() });
  const entry = slots.component('conversation.chat.commandview');

  const cases = [
    ['a successful /if', commandNode({ outcomeKind: 'success' })],
    ['a /if still running', commandNode({ outcomeKind: null })],
    ['a failure without arguments', commandNode({ args: null })],
    ['a failure with blank arguments', commandNode({ args: '   ' })],
  ];
  for (const [label, node] of cases) {
    const tree = render(entry.Component, { node, inputActions: { captureInsertion() {}, insertText: () => true } });
    assert.equal(findTree(tree, (child) => child.type === 'button').length, 0, `no button for: ${label}`);
  }
});

test('disposing the client half releases the settings subscription', async () => {
  const { exports } = await loadClient();
  const slots = createSlots();
  let disposed = 0;
  const forms = createForms();
  forms.describe = () => ({
    getSnapshot: () => ({ status: 'ready', view: { writable: true, hasDocument: true, namespaces: [{ ns: 'if-command' }] } }),
    subscribe: () => () => {
      disposed += 1;
    },
    load: async () => undefined,
  });
  const handle = applyClient(exports, { slots, forms });
  assert.equal(slots.registry.length >= 1, true);
  handle.dispose();
  assert.equal(disposed, 1, 'the mirror subscription is dropped with the plugin');
});
