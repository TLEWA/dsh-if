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
      loading: '加载中…',
      saving: '保存中…',
      saved: '已保存',
      rejected: '未保存：宿主拒绝了这次修改，请重试。',
      failed: '保存失败',
      recoverLabel: '取回 /if',
      recoverTitle: '把这次判断失败的 /if 原始输入放回输入框',
      recoverDone: '已放回输入框',
      recoverBusy: '输入框正忙，请稍后再试',
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
      let cachedKey;
      let disposed = false;
      let retryTimer;

      const snapshot = () => {
        if (!current) return UNBOUND;
        let next;
        try {
          next = current.getSnapshot();
        } catch {
          return UNBOUND;
        }
        // `revision` is optional in the Host snapshot. Comparing it alone kept
        // the first value forever on a host that omits it, so the dropdown
        // showed a stale mode; the value is part of the identity too.
        let key;
        try {
          key = JSON.stringify(next.value ?? null);
        } catch {
          key = undefined;
        }
        if (
          cached !== undefined
          && cached.status === next.status
          && cached.writable === next.writable
          && cached.revision === next.revision
          && cachedKey === key
        ) {
          return cached;
        }
        cached = next;
        cachedKey = key;
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
        if (disposed || attempts >= MIRROR_LOAD_ATTEMPTS) return;
        attempts += 1;
        try {
          const mirror = forms.describe();
          void Promise.resolve(mirror.load?.())
            .catch(() => undefined)
            .then(() => {
              if (disposed || current !== undefined) return;
              const retry = () => {
                retryTimer = undefined;
                if (disposed) return;
                rebind();
                if (current === undefined) scheduleLoad();
              };
              // Remembered so `dispose` can cancel it: an orphaned retry would
              // rebind after unmount and attach a subscription nothing releases.
              if (typeof setTimeout === 'function') retryTimer = setTimeout(retry, MIRROR_LOAD_DELAY_MS);
              else retry();
            });
        } catch {
          // The mirror may not have been declared yet; a later notify retries.
        }
      };

      let mirrorOff;
      rebind();
      try {
        mirrorOff = forms.describe().subscribe?.(() => {
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
          if (!current) return Promise.resolve(false);
          const ops = pairs.map(([field, value]) => ({ op: 'set', path: [field], value }));
          try {
            if (typeof current.mutate === 'function') {
              return Promise.resolve(current.mutate(ops)).then((wrote) => wrote !== false);
            }
            if (typeof current.set === 'function') {
              return Promise.all(pairs.map(([field, value]) => Promise.resolve(current.set(field, value)))).then((results) =>
                results.every((result) => result !== false),
              );
            }
            return Promise.resolve(false);
          } catch (error) {
            return Promise.reject(error instanceof Error ? error : new Error(String(error)));
          }
        },
        dispose() {
          disposed = true;
          if (retryTimer !== undefined) {
            clearTimeout(retryTimer);
            retryTimer = undefined;
          }
          listeners.clear();
          try {
            mirrorOff?.();
          } catch {
            // Cleanup is best-effort; a stale listener only costs a rebind.
          }
          try {
            currentOff?.();
          } catch {
            // Same here.
          }
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
      card: {
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
        color: 'var(--dsw-alias-label-tertiary, inherit)',
        fontSize: 'var(--dsh-content-font-size, 14px)',
        lineHeight: 'calc(24px + var(--dsh-content-font-delta, 0px))',
      },
      cardRow: { display: 'flex', alignItems: 'center', minWidth: 0, gap: 0 },
      cardGlyph: {
        flex: 'none',
        marginRight: 8,
        fontFamily: 'var(--ds-font-family-code, ui-monospace, monospace)',
        fontSize: 12,
        letterSpacing: '-1px',
      },
      cardTitle: { fontWeight: 400, flex: 'none' },
      cardDot: {
        flex: 'none',
        width: 2,
        height: 2,
        margin: '0 8px',
        borderRadius: 1,
        background: 'var(--dsw-alias-label-caption, rgba(127,127,127,.6))',
      },
      cardSummary: {
        flex: 'auto',
        minWidth: 0,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        fontSize: 'var(--dsh-content-font-size-secondary, 13px)',
      },
      cardBody: {
        maxHeight: 260,
        margin: '4px 0 4px 4px',
        padding: '12px 16px',
        borderRadius: 12,
        border: '.5px solid var(--dsw-alias-border-l1, rgba(127,127,127,.25))',
        background: 'var(--dsw-alias-markdown-code-block, rgba(127,127,127,.08))',
        color: 'var(--dsw-alias-label-primary, inherit)',
        fontSize: 12,
        whiteSpace: 'pre-wrap',
        overflow: 'auto',
      },
      recoverButton: {
        flex: 'none',
        marginLeft: 8,
        height: 22,
        padding: '0 8px',
        borderRadius: 999,
        border: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.35))',
        background: 'transparent',
        color: 'inherit',
        fontSize: 12,
        lineHeight: '20px',
        whiteSpace: 'nowrap',
        cursor: 'pointer',
      },
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
          (wrote) => setStatus(wrote === false ? TEXT.rejected : TEXT.saved),
          (error) => setStatus(`${TEXT.failed}：${error instanceof Error ? error.message : String(error)}`),
        );
      };

      const statusText = writable ? status : snapshot.status === 'loading' ? TEXT.loading : TEXT.readOnly;

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
          React.createElement('span', { style: styles.status, role: 'status' }, statusText),
        ),
        React.createElement('p', { style: styles.hint }, hint),
      );
    }

    /**
     * Renderer for `/if` command cards.
     *
     * A failed judge is reported as a `command/run` + `command/done` pair, so the
     * conversation shows a command card the model never reads. That card keeps
     * the original arguments, so the failure card can offer one click that puts
     * the original line back in the input — right where the failure is shown.
     */
    /** Host key with a local fallback: `t` returns the key itself when absent. */
    function localize(t, key, fallback) {
      if (typeof t !== 'function') return fallback;
      try {
        const value = t(key);
        return typeof value === 'string' && value !== '' && value !== key ? value : fallback;
      } catch {
        return fallback;
      }
    }

    function IfCommandCard({ node, inputActions, t }) {
      const outcome = node?.outcome;
      const state = outcome === null || outcome === undefined ? 'running' : outcome.kind === 'error' ? 'error' : 'ok';
      const text = typeof outcome?.text === 'string' ? outcome.text : undefined;
      const summary = text ?? (state === 'error'
        ? localize(t, 'command.failed', '未执行')
        : state === 'ok'
          ? localize(t, 'command.done', '已完成')
          : localize(t, 'command.running', '执行中'));
      const head = typeof node?.name === 'string' && node.name !== '' ? node.name : 'if';
      const args = typeof node?.args === 'string' ? node.args.trim() : '';
      const recoverable = state === 'error' && args !== '' && inputActions !== undefined;
      const body = text !== undefined && text.includes('\n') ? text : null;
      const [expanded, setExpanded] = React.useState(false);
      const [status, setStatus] = React.useState('');
      const open = expanded && body !== null;

      const onToggle = body === null ? undefined : () => setExpanded((value) => !value);
      const onRecover = (event) => {
        event.stopPropagation();
        let inserted = false;
        try {
          inserted = inputActions.insertText(`/if ${args}`, inputActions.captureInsertion()) === true;
        } catch {
          inserted = false;
        }
        setStatus(inserted ? TEXT.recoverDone : TEXT.recoverBusy);
      };

      return React.createElement(
        'div',
        { style: styles.card },
        React.createElement(
          'div',
          { style: styles.cardRow, onClick: onToggle },
          React.createElement('span', { style: styles.cardGlyph, 'aria-hidden': true }, '\u003e_'),
          React.createElement('span', { style: styles.cardTitle }, head),
          React.createElement('span', { style: styles.cardDot, 'aria-hidden': true }),
          React.createElement(
            'span',
            {
              style: state === 'error' ? { ...styles.cardSummary, color: 'var(--dsw-alias-state-error-primary, inherit)' } : styles.cardSummary,
              title: text,
            },
            status === '' ? summary : `${summary} · ${status}`,
          ),
          recoverable
            ? React.createElement(
                'button',
                { type: 'button', style: styles.recoverButton, title: TEXT.recoverTitle, onClick: onRecover },
                TEXT.recoverLabel,
              )
            : null,
        ),
        open ? React.createElement('pre', { style: styles.cardBody, 'data-error': true }, body) : null,
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
        scope.effect(() => () => settingsScope.dispose());
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
        const registerCommandCard = () => {
          try {
            return slots.register({ name: 'conversation.chat.commandview', key: 'if' }, IfCommandCard);
          } catch {
            return undefined;
          }
        };
        scope.effect(() => slots.inject('plugins.row.config', () => register('plugins.row.config', ROW_CONFIG_KEY)));
        scope.effect(() => slots.inject('conversation.chat.commandview', registerCommandCard));
      });
    }

    module.exports = { name: 'dsh-if-client', inject, apply };
    return module.exports;
  },
});
