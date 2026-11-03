# AI usage and code provenance

[简体中文](AI_USAGE.md) · [English](AI_USAGE.en.md)

This document describes the scope of AI involvement in `dsh-if`, how the result was
reviewed, where the code comes from, and the disclaimer. It does not change any term of
the [LICENSE](LICENSE) (MIT).

## 1. Summary

- The **source and documentation were produced mainly with AI assistance**, with the
  project owner setting requirements, reviewing behavior, and verifying results.
- AI is not a copyright holder. The project is released under MIT; users' rights and
  obligations are governed by MIT.
- The project comes with **no warranty**. AI-generated code may contain errors, omissions,
  or behavior unsuitable for your environment.
- No third-party source code was copied or adapted; see [NOTICE.en.md](NOTICE.en.md).

## 2. Tools and models

- Development environment: DeepSeek Harness (DSH) coding agent.
- Model: `deepseek-flash` (DeepSeek).
- Interaction: the project owner described requirements, reported defects, and confirmed
  behavior in natural language; the agent read DSH's public interfaces and runtime
  behavior, wrote code, tests, and documentation, and verified them locally.

## 3. Scope of AI involvement

| Part | AI involvement | Notes |
| --- | --- | --- |
| `lib/index.js` | High | `/if` command, history clipping, judge call, followup message |
| `test/if.test.mjs` | High | registration, YES/NO, multi-line conditions, errors, cache isolation, message identity |
| `README*.md` / `NOTICE*.md` / this file | High | drafted by AI and updated with the code |
| Requirements, defect judgment, final trade-offs | Human | decided by the project owner |

No human rewrote every line. Review focused on **behavioral verification**: reading the
critical path, running tests, and exercising both NO and YES paths in a real DSH client
while inspecting the session log.

## 4. Verified and not fully verified

Verified:

- `npm test` passes 10 tests;
- On DSH `0.2.1-rc.5`, Windows desktop, through CDP in the real Web GUI:
  - `NO`: `/if 1+1=3` + `请只回复 BAD` returned "条件不成立，未执行。"; no user message was sent;
  - `YES`: `/if 1+1=2` + `请只回复 OK` returned "条件成立，指令已作为用户消息发送。";
    a user message `请只回复 OK` and assistant reply `OK` followed;
- The session log confirms: `command/run` has no arguments, the judge call creates no
  session event, and the main session contains only the instruction that was actually sent;
- The session reloads cleanly, and the followup message has `id` and `role: 'user'`.

Not fully verified:

- every DSH version, operating system, theme, and zoom level;
- boundary behavior when a long session hits the 24k-character clip;
- combinations with other command or session-mutating plugins;
- `reasoningEffort` compatibility for every provider (only one retry without the field is implemented).

## 5. Code provenance

- Integrates with DSH host services through public interfaces only; no DSH or bundled-package
  source was copied.
- No third-party plugin code was copied or adapted; see [NOTICE.en.md](NOTICE.en.md).
- Repository history (Git commits) records each change.

## 6. Data and privacy

- The plugin runs locally and contains **no telemetry, analytics, or third-party remote requests**.
- The judge sends "existing session context + condition" to the **model provider configured for
  the current session**, over the same channel as normal chat; it is not sent anywhere else.
- The condition, instruction, and verdict are not written to the main session, but a condition
  may contain sensitive data. Do not put anything into `/if` that you would not send to your
  model provider.
- The plugin does not write session logs; `command/run` and `command/done` are log-only, and
  `recordInput: false` keeps the arguments out of `command/run`.

## 7. Recommendations

1. Read `lib/index.js` before using it in production.
2. Run `npm test`.
3. Keep `NOTICE.en.md` and `LICENSE`.
4. If AI-generated code causes a problem, open an issue or PR; human fixes are welcome.

## 8. Disclaimer

The project is provided "as is", without any express or implied warranty, including but not
limited to merchantability, fitness for a particular purpose, and non-infringement. The
authors and contributors are not liable for any direct or indirect damages arising from use
of this project. The complete terms are in [LICENSE](LICENSE).
