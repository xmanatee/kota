---
id: task-split-workflow-run-executor-ts
title: Split workflow/run-executor.ts (506 lines) into focused modules
status: done
priority: p2
area: workflow
summary: workflow/run-executor.ts is 506 lines. The small filter/timing/retry utilities and the step context builder are good candidates to extract, leaving executeWorkflowRun and its close collaborators in the main file.
created_at: 2026-03-27
updated_at: 2026-03-27
---

## Problem

`src/workflow/run-executor.ts` is 506 lines — well over the 300-line limit.
It mixes pure utility functions (matchesFilter, getEligibleAtMs,
findRetryFromIndex, createStepContext) with the main run orchestration logic
(executeWorkflowRun).

## Desired Outcome

- Extract `matchesFilter`, `getEligibleAtMs`, `findRetryFromIndex` into
  `src/workflow/run-executor-utils.ts` (~50 lines).
- Extract `createStepContext` (and any step-context helpers) into
  `src/workflow/step-context.ts` (~80 lines).
- `run-executor.ts` imports from these and stays under 300 lines.
- All tests pass; no behavioral change.

## Constraints

- Pure extraction — no logic changes.
- All existing callers (`runtime.ts`, tests) must continue to work via
  re-exports or direct imports from the new files.

## Done When

- `run-executor.ts` is under 300 lines.
- Extracted modules are self-contained and well-named.
- Type-check and all tests pass.
