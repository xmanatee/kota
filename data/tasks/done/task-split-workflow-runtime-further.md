---
id: task-split-workflow-runtime-further
title: Further split workflow/runtime.ts (472 lines) — extract queue management
status: done
priority: p2
area: workflow
summary: runtime.ts is still 472 lines after extracting agent-backoff.ts and schedule-triggers.ts. The queue management logic (enqueueRun, pickQueuedRun, restorePendingQueue, persistQueue, ~95 lines) is a cohesive concern that could move to a WorkflowQueueManager, bringing runtime.ts closer to the 300-line target.
created_at: 2026-03-27
updated_at: 2026-03-27
---

## Problem

`src/core/workflow/runtime.ts` was split from 658 lines to 472 lines by extracting `agent-backoff.ts` and `schedule-triggers.ts`. It is still over the 300-line limit.

## Desired Outcome

- Extract queue management (`enqueueRun`, `pickQueuedRun`, `restorePendingQueue`, `persistQueue`, `queue` field) into `src/core/workflow/workflow-queue.ts`.
- `WorkflowQueueManager` takes callbacks for backoff checks and active run state so it stays decoupled from WorkflowRuntime internals.
- `runtime.ts` line count is reduced toward the 300-line target; further splits may be needed in follow-up tasks.

## Constraints

- Pure extraction — no logic changes.
- Keep `WorkflowRuntime` public API unchanged.
- `WorkflowQueueManager` should receive store, backoff callbacks, and log as constructor dependencies.

## Done When

- `src/core/workflow/workflow-queue.ts` exists with a `WorkflowQueueManager` class encapsulating queue state and operations.
- `runtime.ts` delegates to `WorkflowQueueManager` for all queue operations.
- `runtime.ts` line count is measurably reduced from 472 lines.
- Type-check and all tests pass.
