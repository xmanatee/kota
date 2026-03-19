---
id: task-split-workflow-runtime-ts
title: Split workflow/runtime.ts — extract step execution and state management
status: ready
priority: p2
area: structure
summary: workflow/runtime.ts is 563 lines, nearly twice the 300-line limit. The WorkflowRuntime class handles step dispatch, state persistence, event emission, and run lifecycle in one file. Splitting improves navigability.
created_at: 2026-03-19
updated_at: 2026-03-19
---

## Problem

`src/workflow/runtime.ts` is 563 lines (88% over the 300-line limit). The `WorkflowRuntime` class bundles:

- Run lifecycle management (start, complete, fail)
- Step dispatch and execution per step type (tool, agent, code, emit, restart)
- State persistence via `RunStore`
- Event bus emission

These responsibilities are separable even if they share the class boundary.

## Desired Outcome

`workflow/runtime.ts` shrinks to ≤300 lines. A natural split is extracting step execution logic into a `workflow/step-executor.ts` or similar helper, keeping `WorkflowRuntime` as a thin orchestrator. No behavior changes.

## Constraints

- `WorkflowRuntime` and `WorkflowRuntimeConfig` must remain exported from `runtime.ts` or be re-exported through it.
- No changes to public runtime API.
- All tests must pass after the split.

## Done When

- `workflow/runtime.ts` is ≤300 lines.
- The extracted file is ≤300 lines.
- `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build` all pass.
