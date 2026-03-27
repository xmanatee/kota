---
id: task-split-workflow-runtime-ts
title: Split workflow/runtime.ts — extract dispatch logic into runtime-dispatch.ts
status: ready
priority: p2
area: refactor
summary: workflow/runtime.ts is 297 lines, at the 300-line limit. The private dispatch methods (maybeStartNext, runWorkflow, loadDefinitions, emitIdleEvent) form a cohesive dispatch/lifecycle group that can move to a new runtime-dispatch.ts, leaving WorkflowRuntime as the public interface and state container.
created_at: 2026-03-27
updated_at: 2026-03-27
---

## Problem

`src/workflow/runtime.ts` is 297 lines — at the file size limit. It contains `WorkflowRuntime`, a class that mixes the public interface (start, stop, getState, setDispatchPaused) with private dispatch internals (maybeStartNext, runWorkflow, loadDefinitions, emitIdleEvent).

## Desired Outcome

Extract the private dispatch methods (`maybeStartNext`, `runWorkflow`, `loadDefinitions`, `emitIdleEvent`) into a new `src/workflow/runtime-dispatch.ts` file, following the same extracted-function pattern used in `loop-constructor.ts` and similar splits. `WorkflowRuntime` retains the public API and delegates to the extracted functions.

## Constraints

- Public API of `WorkflowRuntime` must not change.
- All existing tests must continue to pass.
- Follow the `AgentLoopState` cast pattern if needed: use `this as unknown as WorkflowRuntimeState` for extracted functions that need private state access.
- `runtime.ts` must end up measurably under 300 lines.

## Done When

- `src/workflow/runtime-dispatch.ts` exists and contains the extracted dispatch functions.
- `src/workflow/runtime.ts` is measurably reduced (under 250 lines preferred).
- All tests pass.
- `workflow/AGENTS.md` is updated to document the new module.
