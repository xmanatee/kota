---
status: done
---

# Split run-executor.ts — extract single-step execution into run-executor-step.ts

## Problem

`src/core/workflow/run-executor.ts` is 287 lines and at the 300-line limit. It combines the outer workflow loop with inline single-step execution handling, including skipped-step logic, try/catch with agentBackoff classification, event emission, and log output. The per-step handling is a self-contained unit that can be extracted.

## Desired Outcome

A new `src/core/workflow/run-executor-step.ts` contains:
- `executeWorkflowStep(...)` — handles a single non-parallel step: calls `executeStep`, records the result via callbacks, emits step events, computes log details, and returns `{ completed, agentBackoff? }`.
- `buildSkippedResult(...)` — produces the `WorkflowStepResult` for a skipped step and handles child-skipping for parallel steps.

`src/core/workflow/run-executor.ts` retains the outer loop, `executeWorkflowRun`, timeout handling, parallel group dispatch, and run-level event emission.

## Constraints

- Public exports from `run-executor.ts` (`executeWorkflowRun`, `RunExecutorDeps`) must not change import paths.
- All tests and imports must continue to pass without modification.

## Done When

- `src/core/workflow/run-executor-step.ts` exists with the per-step execution logic.
- `src/core/workflow/run-executor.ts` is measurably shorter (target ≤ 180 lines).
- `npm run typecheck`, `npm run test`, and `npm run lint` all pass.
