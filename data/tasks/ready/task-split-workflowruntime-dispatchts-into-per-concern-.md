---
id: task-split-workflowruntime-dispatchts-into-per-concern-
title: Split workflow/runtime-dispatch.ts into per-concern sibling files
status: ready
priority: p2
area: core
summary: Split src/core/workflow/runtime-dispatch.ts (371 lines) into per-concern siblings: runtime-dispatch-definitions.ts, runtime-dispatch-concurrency.ts, runtime-dispatch-dirty-recovery.ts; runtime-dispatch.ts retains the dispatch loop and triggerWorkflow plumbing.
created_at: 2026-05-06T04:32:09.754Z
updated_at: 2026-05-06T04:32:09.754Z
---

## Problem

`src/core/workflow/runtime-dispatch.ts` is 371 lines and bundles four
orthogonal concerns under one file:

1. **Definition compilation/resolution** — `compileDefinitions`,
   `assertRegisteredHarnessesInSteps`, `resolveDefinitions`, and
   `loadDefinitions` translate `workflowInputs` to validated
   `WorkflowDefinition[]` and assert that every agent step references a
   registered harness.
2. **Concurrency-group bookkeeping** — `getConcurrencyGroup`,
   `activeCountForGroup`, `canDispatchDefinition` decide whether a
   queued workflow can dispatch under the configured agent/code
   concurrency limits.
3. **Dirty-completion recovery** — `handleDirtyCompletion` reads the
   repo worktree status after a run, attributes residual dirt to the
   completing workflow if the fingerprint changed, updates
   `store.recovery`, drains the queue, and pauses dispatch on the
   second attempt. This already follows the recovery contract in
   `src/modules/autonomy/workflows/AGENTS.md`, but lives mid-file
   alongside unrelated dispatch helpers.
4. **Dispatch loop / lifecycle** — `emitIdleEvent`, `maybeStartNext`,
   `triggerWorkflowFromStep`, `runWorkflow` plus the
   `WorkflowRuntimeDispatchState` type form the actual dispatch loop
   the runtime exposes.

These four concerns map cleanly onto the per-concern split convention
already established by the recent `workflow/types.ts`,
`workflow/validation.ts`, `workflow/step-input-types.ts`,
`run-store-helpers.ts`, `daemon-control-chat.ts`,
`step-executor-agent` cluster (commits d30d91c4 → 71370273). Splitting
this file completes that cluster's coverage of `src/core/workflow/`'s
remaining mid-sized multi-concern files and keeps the source tree
moving toward the `src/AGENTS.md` goal of a small protocol-oriented
core.

## Desired Outcome

`src/core/workflow/runtime-dispatch.ts` is split into per-concern
sibling files:

- `runtime-dispatch-definitions.ts` — `compileDefinitions`,
  `assertRegisteredHarnessesInSteps`, `resolveDefinitions`,
  `loadDefinitions` (the last one re-exports a thin call that uses
  `state.store.setDefinitionsLoadedAt`).
- `runtime-dispatch-concurrency.ts` — `getConcurrencyGroup`,
  `activeCountForGroup`, `canDispatchDefinition`.
- `runtime-dispatch-dirty-recovery.ts` — `handleDirtyCompletion`.
- `runtime-dispatch.ts` retains the `WorkflowRuntimeDispatchState`
  type, `emitIdleEvent`, `maybeStartNext`, `triggerWorkflowFromStep`,
  `runWorkflow`, and the public surface that other parts of the
  runtime (`runtime-lifecycle.ts`, `runtime-runs-control.ts`,
  `runtime.ts`) call.

The split is a pure refactor: every public symbol the runtime currently
exports from `runtime-dispatch.ts` is still importable from the same
path. Internal helpers move with their concern.

## Constraints

- No public-API changes. Every function the rest of `src/core/` and
  the autonomy module currently imports from
  `#core/workflow/runtime-dispatch.js` continues to be importable from
  the same module specifier (re-export through `runtime-dispatch.ts`
  if needed).
- No behavior changes — this is a pure split. The repair-loop's
  recovery semantics, concurrency caps, and idle-event emission must
  remain bit-for-bit identical.
- Imports use `#core/*` package imports per `src/AGENTS.md`. No new
  alias systems.
- Strict types preserved: do not add `unknown`, `any`, optional
  fields, or fallbacks during the split.
- No backwards-compatibility shims. If a function moves, its single
  call site updates to the new module.
- Each new file fits well under the ~300-line guideline; the residual
  `runtime-dispatch.ts` should also drop comfortably under it.
- Keep the existing `runtime-dispatch.test.ts` (or equivalent
  coverage) green; no test logic changes beyond import-path
  rewrites.
- `WorkflowRuntimeDispatchState` stays the single shared state type
  imported by every sibling; do not duplicate the interface across
  files.

## Done When

- `src/core/workflow/runtime-dispatch.ts` contains only the dispatch
  loop, idle-event emission, `triggerWorkflowFromStep`, `runWorkflow`,
  and the `WorkflowRuntimeDispatchState` interface (≤ ~200 lines).
- `runtime-dispatch-definitions.ts`,
  `runtime-dispatch-concurrency.ts`, and
  `runtime-dispatch-dirty-recovery.ts` each own one concern,
  re-importing `WorkflowRuntimeDispatchState` from `runtime-dispatch.ts`.
- All existing tests pass (`pnpm typecheck`, `pnpm test`,
  `pnpm validate-tasks`).
- Workflow integration and dispatch tests covering recovery,
  concurrency caps, and idle emission still pass without
  modification beyond import-path rewrites.

## Source / Intent

Continuation of the per-concern split cluster recorded in commits
71370273, 70bffdf5, 28d13814, 8a981269, 3dfb20ae, c1e6b1f4, 0ef8e311,
3f5c0d44, 812228de, 003e4cc3, d4fa35fd, fd3949b3, 20ff7270, 4d03ac28,
7b05e61b, 194ba74c, 5da3c39f, 83c34127, 40ff42c1, d30d91c4. The
recent rhythm has been one per-concern split per builder cycle inside
`src/core/`, advancing the explicit `src/AGENTS.md` goal of keeping
`src/core/` a small protocol-oriented kernel and shrinking files
that bundle multiple concerns into siblings that name their concern
in the filename.

## Initiative

Core boundary cleanup: keep `src/core/workflow/` a small set of
clearly-named per-concern files so dispatch, definition compilation,
concurrency bookkeeping, and dirty-worktree recovery each live in a
file an agent can read in one pass.

## Acceptance Evidence

- File-size deltas in the PR/commit show
  `src/core/workflow/runtime-dispatch.ts` measurably smaller
  (≤ ~200 lines) and three new sibling files each owning a single
  concern. The git diff itself is the rendered evidence (this is a
  non-client refactor — area is `core`, not `client`/`channel`).
- `pnpm typecheck` and `pnpm test` runs in the run directory show
  green.
- `pnpm validate-tasks` confirms the queue stays consistent after
  the task moves to `done/`.
