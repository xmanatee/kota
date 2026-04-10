---
id: task-split-workflow-validation-ts
title: Split workflow/validation.ts (306 lines) — extract trigger validation
status: done
priority: p2
area: workflow
summary: workflow/validation.ts is 306 lines and still contains both trigger validation logic and the workflow registration/top-level validation functions. Extracting trigger validation into a dedicated module would bring the file under 300 lines and continue the pattern already established with validation-primitives.ts and validation-steps.ts.
created_at: "2026-03-27"
updated_at: "2026-03-27"

---

## Problem

`src/core/workflow/validation.ts` is 306 lines. It already delegated step validators to `validation-steps.ts` and shared primitives to `validation-primitives.ts`, but the internal `validateTrigger` function (~84 lines) still lives here alongside `validateStep`, `registerWorkflowDefinition`, and `validateWorkflowDefinitions`. The file is over the 300-line limit.

## Desired Outcome

Extract `validateTrigger` (and any helpers it uses) into `src/core/workflow/validation-trigger.ts`. Update `validation.ts` to import from the new module. Both files stay under 300 lines.

## Constraints

- Follow the established pattern: primitives in `validation-primitives.ts`, step validators in `validation-steps.ts`, trigger validator in `validation-trigger.ts`.
- Do not change validation logic or error messages.
- No re-export shims — update all call sites.

## Done When

- `src/core/workflow/validation-trigger.ts` exists and contains trigger validation logic.
- `src/core/workflow/validation.ts` is under 300 lines.
- `npx tsc --noEmit` passes with no new errors.
