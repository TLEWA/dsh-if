/**
 * dsh-if — browser half.
 *
 * Registers the `/if` row's configuration page in DSH's plugin settings: one
 * select for `mode` (`message` by default, `background` for the 0.2.x
 * behaviour). The values are the Host's own config namespaces — this half only
 * draws the control and forwards one `set` operation, so the page and the
 * plugin always read the same document.
 *
 * Loaded by DSH's on-demand client loader from `exports["./client"]`; the
 * module format is the loader's `window.__ModuleLoader__.load` envelope.
 */
window.__ModuleLoader__.load({
  id: 'dsh-if',
  factory(require) {
    // The loader evaluates the chunk as a plain function body: `module` is not
    // injected, so every chunk declares its own (as DSH's bundled chunks do).
    const module = { exports: {} };
    const React = require('react');

    const BUNDLE_NAME = 'dsh-if';
    const ROW_ID = 'if-command';
    const ROW_CONFIG_KEY = `${BUNDLE_NAME}#${ROW_ID}`;
    const MIRROR_LOAD_ATTEMPTS = 6;
    const MIRROR_LOAD_DELAY_MS = 300;

    const TEXT = {
      summaryMessage: '与普通消息一起排队（默认）',
      summaryBackground: '后台排队（0.2.x 行为）',
      label: '判断方式',
      message: '与普通消息一起排队（默认）',
      background: '后台排队（0.2.x 行为）',
      hintMessage:
        '斜杠命令本身仍会立即执行，但 /if 会把这一行原文放进输入框上方的排队面板：回合开始时再判断，期间可以编辑、删除或插话。',
      hintBackground:
        '命令立即返回，/if 在后台等到当前回合结束后判断；排队面板里看不到它，也不能编辑或插话。',
      unavailable: '配置暂不可用：宿主没有暴露这一行的配置命名空间。',
      readOnly: '当前 profile 不接受写入，只能查看。',
      saving: '保存中…',
      saved: '已保存',
      failed: '保存失败',
    };

    function namespaceOf(entry) {
      if (typeof entry !== 'object' || entry === null) return undefined;
      if (typeof entry.ns === 'string') return entry.ns;
      if (typeof entry.nsId === 'string') return entry.nsId;
      return undefined;
    }

    function pickNamespace(forms) {
      if (!forms) return undefined;
      let listed = [];
      try {
        listed = forms.describe().getSnapshot().view?.namespaces ?? [];
      } catch {
        return undefined;
      }
      const names = listed.map(namespaceOf).filter((ns) => ns !== undefined);
      return (
        names.find((ns) => ns === ROW_ID) ??
        names.find((ns) => ns === `include:${ROW_ID}`) ??
        names.find((ns) => ns === BUNDLE_NAME) ??
        names.find((ns) => /(?:^|[#:/-])if-command$/.test(ns)) ??
        undefined
      );
    }

    /** A tiny live view over the Host's config namespace for this row. */
    function createSettingsScope(forms) {
      let current;
      let currentOff;
      let attempts = 0;
      const listeners = new Set();
      const notify = () => {
        for (const listener of listeners) listener();
      };
      const UNBOUND = { status: 'unavailable', writable: false };
      let cached;

      const snapshot = () => {
        if (!current) return UNBOUND;
        let next;
        try {
          next = current.getSnapshot();
        } catch {
          return UNBOUND;
        }
        if (cached !== undefined && cached.status === next.status && cached.writable === next.writable && cached.revision === next.revision) {
          return cached;
        }
        cached = next;
        return cached;
      };

      const rebind = () => {
        const namespace = pickNamespace(forms);
        let next;
        if (namespace !== undefined) {
          try {
            next = forms.get(namespace);
          } catch {
            next = undefined;
          }
        }
        if (next === current) return;
        currentOff?.();
        current = next;
        cached = undefined;
        currentOff = next?.subscribe?.(notify);
        notify();
      };

      const scheduleLoad = () => {
        if (attempts >= MIRROR_LOAD_ATTEMPTS) return;
        attempts += 1;
        try {
          const mirror = forms.describe();
          void Promise.resolve(mirror.load?.())
            .catch(() => undefined)
            .then(() => {
              if (current !== undefined) return;
              if (attempts >= MIRROR_LOAD_ATTEMPTS) return;
              if (typeof setTimeout === 'function') setTimeout(rebind, MIRROR_LOAD_DELAY_MS);
              else rebind();
            });
        } catch {
          // The mirror may not have been declared yet; a later notify retries.
        }
      };

      rebind();
      try {
        forms.describe().subscribe?.(() => {
          rebind();
          if (current === undefined) scheduleLoad();
        });
      } catch {
        // A missing subscribe only costs the live updates, not the binding.
      }
      if (current === undefined) scheduleLoad();

      return {
        getSnapshot: snapshot,
        subscribe(listener) {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
        setMany(pairs) {
          if (!current) return Promise.resolve(undefined);
          const ops = pairs.map(([field, value]) => ({ op: 'set', path: [field], value }));
          try {
            if (typeof current.mutate === 'function') return Promise.resolve(current.mutate(ops));
            if (typeof current.set === 'function') {
              return Promise.all(pairs.map(([field, value]) => Promise.resolve(current.set(field, value)))).then((results) =>
                results.every(Boolean),
              );
            }
            return Promise.resolve(undefined);
          } catch (error) {
            return Promise.reject(error instanceof Error ? error : new Error(String(error)));
          }
        },
        bound() {
          return current !== undefined;
        },
      };
    }

    const styles = {
      wrap: { display: 'flex', flexDirection: 'column', gap: 10, padding: '4px 0 12px' },
      title: { fontSize: 14, fontWeight: 600, color: 'var(--dsw-alias-text-l1, inherit)' },
      row: { display: 'flex', alignItems: 'center', gap: 10 },
      select: {
        minWidth: 220,
        padding: '6px 8px',
        borderRadius: 8,
        border: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.35))',
        background: 'var(--dsw-alias-bg-l2, transparent)',
        color: 'inherit',
        fontSize: 13,
      },
      hint: { fontSize: 12, lineHeight: 1.6, opacity: 0.72, maxWidth: 560 },
      status: { fontSize: 12, opacity: 0.72 },
    };

    function IfSettingsCard({ view, scope }) {
      const snapshot = React.useSyncExternalStore(scope.subscribe, scope.getSnapshot, scope.getSnapshot);
      const mode = snapshot.value?.mode === 'background' ? 'background' : 'message';
      const writable = snapshot.writable === true && snapshot.status === 'ready';
      const [status, setStatus] = React.useState('');

      if (view === 'summary') {
        return React.createElement('p', { style: styles.hint }, mode === 'message' ? TEXT.summaryMessage : TEXT.summaryBackground);
      }

      const hint = mode === 'message' ? TEXT.hintMessage : TEXT.hintBackground;
      if (snapshot.status === 'unavailable') {
        return React.createElement('p', { style: styles.hint }, TEXT.unavailable);
      }

      const onChange = (event) => {
        const next = event.target.value;
        setStatus(TEXT.saving);
        Promise.resolve(scope.setMany([['mode', next]])).then(
          () => setStatus(TEXT.saved),
          (error) => setStatus(`${TEXT.failed}：${error instanceof Error ? error.message : String(error)}`),
        );
      };

      return React.createElement(
        'div',
        { style: styles.wrap },
        React.createElement('div', { style: styles.title }, TEXT.label),
        React.createElement(
          'div',
          { style: styles.row },
          React.createElement(
            'select',
            { style: styles.select, value: mode, disabled: !writable, onChange, 'aria-label': TEXT.label },
            React.createElement('option', { value: 'message' }, TEXT.message),
            React.createElement('option', { value: 'background' }, TEXT.background),
          ),
          React.createElement('span', { style: styles.status, role: 'status' }, writable ? status : TEXT.readOnly),
        ),
        React.createElement('p', { style: styles.hint }, hint),
      );
    }

    const inject = ['slots'];

    function apply(ctx) {
      const slots = ctx.slots;
      if (!slots) return;
      ctx.inject(['configForms'], (scope) => {
        const forms = scope.get('configForms');
        if (!forms) return;
        const settingsScope = createSettingsScope(forms);
        const face = { scope: settingsScope };
        const register = (slotName, key) => {
          try {
            return slots.register(
              { name: slotName, key, priority: 30, inject: () => face },
              IfSettingsCard,
            );
          } catch {
            return undefined;
          }
        };
        scope.effect(() => slots.inject('plugins.row.config', () => register('plugins.row.config', ROW_CONFIG_KEY)));
      });
    }

    module.exports = { name: 'dsh-if-client', inject, apply };
    return module.exports;
  },
});
