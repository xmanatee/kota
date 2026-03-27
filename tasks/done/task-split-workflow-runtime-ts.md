---
id: task-split-workflow-runtime-ts
title: Split workflow/runtime.ts (658 lines) into focused modules
status: done
priority: p2
area: workflow
summary: workflow/runtime.ts has grown to 658 lines — well over the 300-line limit. Extract schedule trigger management and agent backoff logic into dedicated modules, leaving WorkflowRuntime as a thin orchestrator.
created_at: 2026-03-27
updated_at: 2026-03-27
---

## Problem

`src/workflow/runtime.ts` is 658 lines. It has grown back past the limit since
the previous split. The class contains at least three separable concerns:
lifecycle/dispatch, schedule trigger management, and agent backoff logic.

## Desired Outcome

- Extract schedule trigger management (setupScheduleTriggers, scheduleNextFire,
  reconcileScheduleTriggers, ~100 lines) into `src/workflow/schedule-triggers.ts`.
- Extract agent backoff logic (getActiveAgentBackoff, dropQueuedAgentWorkflows,
  applyAgentBackoff, clearAgentBackoff, shouldSuppressAgentWorkflow, ~80 lines)
  into `src/workflow/agent-backoff.ts`.
- `runtime.ts` delegates to these modules; stays under 300 lines.
- All tests pass; no behavioral change.

## Constraints

- Pure extraction — no logic changes.
- Keep the existing public API of `WorkflowRuntime` unchanged.

## Done When

- `runtime.ts` is under 300 lines.
- `schedule-triggers.ts` and `agent-backoff.ts` each have clear, focused purposes.
- Type-check and all tests pass.
