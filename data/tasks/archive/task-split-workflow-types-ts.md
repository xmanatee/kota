---
status: done
---

# Split workflow/types.ts (331 lines) — extract run-execution types

## Problem

`src/core/workflow/types.ts` is 331 lines and contains two distinct concerns: workflow definition types (triggers, step inputs/outputs, definitions) and runtime execution types (run status, step results, run metadata, execution context, predicates, repair config). This mixed file violates the 300-line limit and makes it harder to navigate.

## Desired Outcome

Extract runtime execution types into `src/core/workflow/run-types.ts`. The target types to move include `WorkflowRunStatus`, `WorkflowStepStatus`, `WorkflowActiveRun`, `WorkflowRuntimeState`, `WorkflowContextInfo`, `WorkflowStepContext`, `WorkflowValueResolver`, `WorkflowPredicate`, `WorkflowRepairCheck`, `WorkflowRepairLoopConfig`, `WorkflowQueuedRun`, `WorkflowStepResult`, `WorkflowRunExecutionResult`, and `WorkflowRunMetadata`. Update all import sites to reference the new module. `workflow/types.ts` retains definition/step/trigger types and stays under 300 lines.

## Constraints

- Do not change type signatures, names, or semantics.
- All existing importers must be updated to the new file; no re-export shims.
- Keep `workflow/types.ts` as the home for definition-time types (triggers, step kinds, `WorkflowDefinition`).

## Done When

- `src/core/workflow/run-types.ts` exists and contains the runtime execution types.
- `src/core/workflow/types.ts` is under 300 lines.
- `npx tsc --noEmit` passes with no new errors.
