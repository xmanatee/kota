---
id: task-split-workflow-runtime-ts
title: Split workflow/runtime.ts (382 lines) — extract event handling and budget alerting
status: done
priority: p2
area: workflow
summary: workflow/runtime.ts is still 382 lines after prior extractions (queue, backoff, schedule-triggers). The remaining WorkflowRuntime class mixes lifecycle (start/stop), event handling/dispatch, idle loop, signal polling, and Telegram budget alerting. Extract the budget alert and/or event dispatch logic into focused modules to bring the file under 300 lines.
created_at: 2026-03-27
updated_at: 2026-03-27
---

## Problem

`src/workflow/runtime.ts` is 382 lines. Previous splits extracted `WorkflowQueueManager`,
`AgentBackoffManager`, and `ScheduleTriggerManager`, but `WorkflowRuntime` still contains
lifecycle management, event-dispatch logic, idle/signal polling, and Telegram budget alerting
in a single class.

## Desired Outcome

Budget alert logic (currently `sendBudgetAlert` using `callTelegramApi`) and/or the
event-dispatch/signal-polling internals are extracted into small focused modules.
`WorkflowRuntime` delegates to them, reducing the file to under 300 lines.

## Constraints

- Follow the module pattern already established in the workflow directory
- Do not change public API of `WorkflowRuntime` or observable behavior

## Done When

- `workflow/runtime.ts` is under 300 lines.
- All existing tests pass.
- Type checking and lint pass.

## What Was Done

Extracted five focused modules:
- `src/workflow/budget-guard.ts` — `BudgetGuard` class encapsulating daily spend tracking and Telegram alerts
- `src/workflow/runtime-signals.ts` — `checkAbortSignal`, `checkReloadSignal` functions and all signal-file constants (`ABORT_SIGNAL_FILE`, `PAUSE_SIGNAL_FILE`, `RELOAD_SIGNAL_FILE`)
- `src/workflow/runtime-config.ts` — `WorkflowRuntimeConfig` type definition
- `enqueueMatchingWorkflows` and `workflowUsesAgent` added to `run-executor-utils.ts`

`runtime.ts` reduced from 382 to 298 lines. All 4935 tests pass.
