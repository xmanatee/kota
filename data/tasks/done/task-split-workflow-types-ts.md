---
id: task-split-workflow-types-ts
title: Split workflow/types.ts (331 lines) — extract run-execution types
status: done
priority: p2
area: workflow
summary: workflow/types.ts is 331 lines mixing workflow definition types (triggers, steps, definitions) with runtime execution types (run status, step results, run metadata, context, predicates). Extract the runtime execution types into a focused module to bring each file under 300 lines.
created_at: "2026-03-27"
updated_at: "2026-03-27"
---

## Problem

`src/workflow/types.ts` is 331 lines and contains two distinct concerns: workflow definition types (triggers, step inputs/outputs, definitions) and runtime execution types (run status, step results, run metadata, execution context, predicates, repair config). This mixed file violates the 300-line limit and makes it harder to navigate.

## Desired Outcome

Extract runtime execution types into `src/workflow/run-types.ts`. The target types to move include `WorkflowRunStatus`, `WorkflowStepStatus`, `WorkflowActiveRun`, `WorkflowRuntimeState`, `WorkflowContextInfo`, `WorkflowStepContext`, `WorkflowValueResolver`, `WorkflowPredicate`, `WorkflowRepairCheck`, `WorkflowRepairLoopConfig`, `WorkflowQueuedRun`, `WorkflowStepResult`, `WorkflowRunExecutionResult`, and `WorkflowRunMetadata`. Update all import sites to reference the new module. `workflow/types.ts` retains definition/step/trigger types and stays under 300 lines.

## Constraints

- Do not change type signatures, names, or semantics.
- All existing importers must be updated to the new file; no re-export shims.
- Keep `workflow/types.ts` as the home for definition-time types (triggers, step kinds, `WorkflowDefinition`).

## Done When

- `src/workflow/run-types.ts` exists and contains the runtime execution types.
- `src/workflow/types.ts` is under 300 lines.
- `npx tsc --noEmit` passes with no new errors.
