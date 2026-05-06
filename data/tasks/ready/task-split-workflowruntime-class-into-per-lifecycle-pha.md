---
id: task-split-workflowruntime-class-into-per-lifecycle-pha
title: Split WorkflowRuntime class into per-lifecycle-phase sibling files
status: ready
priority: p1
area: core
summary: Collapse src/core/workflow/runtime.ts (591 lines) WorkflowRuntime class into a thin orchestrator that delegates each lifecycle phase (start/stop, definition management, run lifecycle/control, event handling, recovery) to dedicated sibling files, matching the recent Daemon-class per-lifecycle-phase split.
created_at: 2026-05-06T00:28:03.691Z
updated_at: 2026-05-06T00:28:03.691Z
---

## Problem

`src/core/workflow/runtime.ts` is now the largest non-test file in
`src/core/workflow/` at 591 lines (the next-largest workflow runtime files
are `runtime-dispatch.ts` at 374 and `run-executor-step.ts` at 357). The
single `WorkflowRuntime` class bundles five distinct lifecycle phases into
one declaration:

- start / stop / pause / dispatch-window state (`start`, `stop`,
  `isBusy`, `isDispatchPaused`, `setDispatchPaused`, `pauseDispatch`,
  `getDispatchWindowStatus`, `loadDefinitions`).
- definition management (`setWorkflowInputs`,
  `reloadWorkflowDefinitions`, `validateDefinitions`,
  `getDefinitionCount`, `getDefinitions`,
  `getDefinitionSourceEnabled`, `disableWorkflow`, `enableWorkflow`,
  `getState`).
- run lifecycle / control (`abortActiveRuns`, `abortActiveRun`,
  `enqueuePendingRun`, `enqueueWebhookRun`, `cancelQueuedRun`,
  `runWorkflow`).
- event handling and dispatch (`handleEvent`, `maybeStartNext`,
  `emitIdleEvent`, `queueMatchingEventFirst`).
- recovery (`queueInterruptedRunRecovery`, `queueRecovery`).

Each phase already cuts cleanly along the dispatch helpers shared with
`runtime-dispatch.ts` (it consumes the runtime through a
`WorkflowRuntimeDispatchState` cast). Existing siblings — `runtime-config.ts`,
`runtime-signals.ts`, `runtime-dispatch.ts`, `agent-backoff.ts`,
`schedule-triggers.ts`, `watch-triggers.ts`, `workflow-queue.ts` —
already establish the per-concern seam. Each new builder migration adds
helpers or branches to the same monolith file.

## Desired Outcome

`runtime.ts` becomes a thin `WorkflowRuntime` orchestrator that holds the
shared private state (store, queue manager, backoff manager, schedule and
watch trigger managers, definitions, active runs map, dispatch flags) and
delegates each lifecycle phase to a dedicated sibling file, matching the
per-lifecycle-phase split that landed for the `Daemon` class
(`daemon-startup.ts`, `daemon-shutdown.ts`, `daemon-state.ts`,
`daemon-state-persistence.ts`, `daemon-subscriptions.ts`,
`daemon-instance-lock.ts`, etc.). The orchestrator keeps only construction,
field declarations, and the small forwarding methods. All non-trivial
lifecycle logic lives in the per-phase sibling files.

## Constraints

- One mechanism: extend the existing per-concern sibling-file pattern in
  `src/core/workflow/`. Do not introduce a new directory layer or a
  parallel registry of phase modules.
- Sibling files take an explicit state interface (similar to
  `WorkflowRuntimeDispatchState`) rather than a reference to the
  orchestrator instance. Keep the interface narrow per phase — each
  helper sees only the fields it needs.
- Preserve the public class surface. Every method currently exported via
  `WorkflowRuntime` keeps its name, signature, and observable behavior.
  The orchestrator forwards to the new sibling helpers; callers do not
  change.
- Do not split type declarations into a parallel `runtime-types.ts` and
  do not duplicate the `WorkflowRuntimeConfig` re-export. Keep
  `runtime.ts` as the canonical public entry.
- No backwards-compatibility shim. Delete the inline implementations
  rather than aliasing them.
- Update `src/core/workflow/AGENTS.md` (or the closest local
  `AGENTS.md`) to name the per-lifecycle-phase convention and the
  orchestrator-vs-phase boundary so future contributors do not
  reintroduce the monolith. Do not duplicate that note across multiple
  docs.

## Done When

- `src/core/workflow/runtime.ts` shrinks to a thin orchestrator
  (target: ≤ ~250 lines, excluding imports and field declarations).
- Each lifecycle phase listed in Problem lives in its own sibling file
  (suggested names: `runtime-lifecycle.ts`, `runtime-definitions.ts`,
  `runtime-runs-control.ts`, `runtime-events.ts`,
  `runtime-recovery.ts`). Files may be merged where two phases share
  more state than they hide; the resulting layout must keep each file
  cohesive and avoid bouncing through three files for one method.
- `pnpm typecheck` and `pnpm test` pass.
- `src/strict-types-policy-baseline.json` is regenerated only for the
  new file relocations (no net new `unknown` / `Record<string,
  unknown>` / `as unknown` usages).
- The local `AGENTS.md` notes the per-lifecycle-phase convention.

## Source / Intent

Continuation of the architectural-anchor split cluster that landed
McpServer (841 → 197 lines via per-feature handlers), ModuleLoader
(814 → split via per-load-phase handlers), Daemon (666 → 215 via
per-lifecycle-phase siblings), and step-executor-agent (603 → 249 via
per-phase siblings) on consecutive recent autonomy runs (commits
22f89e05, 70bffdf5, 28d13814, c1e6b1f4). `runtime.ts` is now the
largest remaining workflow-runtime file and accretes a helper or
branch on every workflow-runtime migration; the per-lifecycle-phase
seam is already implicit in `runtime-dispatch.ts`'s
`WorkflowRuntimeDispatchState` cast and only needs to be extended to
the rest of the class.

## Initiative

Minimal-core / module-first architecture: shrink the largest core
files into thin orchestrators that delegate to per-phase or
per-feature sibling helpers, so each workflow-runtime migration has
a clear seam to land in instead of a monolith to grow.

## Acceptance Evidence

- `wc -l src/core/workflow/runtime.ts` recorded before and after,
  showing the orchestrator below the ~250-line target.
- New sibling files listed with line counts in the commit message.
- `pnpm typecheck` and `pnpm test` transcripts are clean (commit
  step's repair-loop checks already cover this; the commit message
  must reference the validation gates that ran).
- `src/core/workflow/AGENTS.md` (or the closest applicable local
  `AGENTS.md`) lists the per-lifecycle-phase convention and the
  orchestrator-vs-phase boundary.
