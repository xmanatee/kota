---
id: task-split-workflow-validation-ts
title: Split workflow/validation.ts — extract primitive validators
status: done
priority: p2
area: structure
summary: workflow/validation.ts is 601 lines, twice the 300-line limit. It mixes low-level value validators with step-type validation and top-level registration. Extracting the primitive validators improves navigability.
created_at: 2026-03-19
updated_at: 2026-03-19
completed_at: 2026-03-19
promoted_at: 2026-03-19
---

## Problem

`src/workflow/validation.ts` is 601 lines (100% over the 300-line limit). It contains two separable layers:

- Primitive field validators (`expectRelativePath`, `expectName`, `expectNonEmptyString`, `expectOptionalString`, `expectOptionalBoolean`, `expectOptionalInteger`, `expectOptionalScalarFilter`, etc.)
- Step-type validators (`validateToolStep`, `validateAgentStep`, `validateEmitStep`, `validateRestartStep`, `validateCodeStep`, `validateStep`)
- Top-level registry functions (`registerWorkflowDefinition`, `validateWorkflowDefinitions`)

The primitive validators have no dependency on workflow types and can live independently.

## Desired Outcome

`workflow/validation.ts` shrinks to ≤300 lines. Primitive validators move to a small `workflow/validation-primitives.ts` or similar. No behavior changes.

## Constraints

- `registerWorkflowDefinition` and `validateWorkflowDefinitions` must remain exported from `validation.ts` or re-exported through it.
- No changes to the public validation API.
- All tests must pass after the split.

## Done When

- `workflow/validation.ts` is ≤300 lines.
- The extracted file is ≤300 lines.
- `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build` all pass.
