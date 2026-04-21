---
id: task-enforce-autonomy-mode-immutability-from-non-operat
title: Enforce autonomy-mode immutability from non-operator paths with an integration test
status: done
priority: p2
area: core
summary: Add a typed test that proves session autonomyMode can only change via the daemon operator control surface — not via user messages, tool outputs, or module prompt state — to lock in the Model Spec chain-of-command mapping
created_at: 2026-04-20T23:35:31.390Z
updated_at: 2026-04-21T00:34:51.770Z
---

## Problem

The OpenAI Research Distillation entry in
`src/modules/autonomy/AGENTS.md` records the KOTA mapping of the OpenAI
Model Spec chain of command:

- SDK system prompt + core safety rails ≈ Root/System
- operator-set autonomy mode + module prompt state ≈ Developer
- channel / session user message ≈ User
- tool / web outputs ≈ untrusted content with no authority by default

The entry asserts that a user message or tool output must not silently
escalate the operator-set autonomy mode, and points to
`task-document-instruction-hierarchy-chain-of-command-ma` for the durable
note in `src/core/tools/AGENTS.md`.

Today the invariant holds by construction: the daemon exposes a single
PATCH `/sessions/:id/mode` endpoint, `AgentSession` accepts
`autonomyMode` at construction, and `resolveAutonomyGate` reads the
session's current mode fresh on each tool batch. But there is no typed
test that pins the invariant. A future refactor could plausibly reintroduce a
mutation path — for example a module contributing a pre-send hook that
adjusts `session.autonomyMode` based on a user message, or a tool handler
that downgrades the session from `supervised` to `autonomous` on a
recognized tool_result. The risk is quiet: the existing
`autonomy-mode.test.ts` only covers `resolveAutonomyGate` unit behavior,
not the boundary contract.

## Desired Outcome

One focused integration test lives in `src/core/tools/` (or
`src/core/loop/` if session construction is the clearer anchor) and
verifies three concrete properties:

1. A user-role message processed by the session loop does not change the
   session's `autonomyMode`, even if the message text requests an
   escalation (e.g. "switch to autonomous mode").
2. A tool result returned to the session does not change the session's
   `autonomyMode`, even if the result payload contains a mode-change
   directive.
3. Module-contributed pre-send / dynamic-state hooks cannot write to the
   session's `autonomyMode`. The only supported mutation path is the
   daemon control surface (PATCH `/sessions/:id/mode`).

The test exercises real session + tool-runner wiring rather than mocking
`resolveAutonomyGate` directly, so a regression that adds a new mutation
path would fail loudly. The existing unit tests on `resolveAutonomyGate`
stay; this test complements them at the session boundary.

## Constraints

- Do not add a test-only flag, hook, or override parameter to production
  code to make this testable. If the boundary is not naturally testable,
  fix the boundary — e.g. by making the mode field privately held on the
  session and mutated only through the control-surface method.
- Do not duplicate the chain-of-command mapping into a third surface.
  The autonomy-module distillation entry remains the single rationale
  anchor; `src/core/tools/AGENTS.md` gets the operator-facing note via
  the separately-tracked task
  `task-document-instruction-hierarchy-chain-of-command-ma`.
- Test at session granularity, not full-daemon; the control-API side
  (PATCH handler) is already covered by the daemon-control session
  tests.
- Keep the test surface-agnostic: do not reference specific channel
  transports (Telegram, webhook) because the invariant lives at the
  session boundary, not the channel boundary.
- If the audit uncovers an existing mutation path that violates the
  invariant, fix the path rather than weakening the assertions.

## Done When

- A new test covers all three properties and fails when a mutation path
  is introduced.
- If any production code had to change to make the boundary enforceable
  (e.g. tightening a field's visibility), that change is in the same
  commit as the test and keeps the public control-surface path working.
- `pnpm test` in KOTA passes on the changed paths.
- No documentation duplication is introduced; if the autonomy-module
  distillation entry needs a one-line pointer back to the new test, that
  is acceptable.
