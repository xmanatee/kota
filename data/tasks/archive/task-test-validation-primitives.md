---
status: done
---

# Add direct unit tests for validation-primitives.ts

## Problem

`src/core/workflow/validation-primitives.ts` was extracted from `validation.ts` during a recent split and has no dedicated test file. It is only exercised indirectly through `validation.test.ts`.

## Desired Outcome

A dedicated `src/core/workflow/validation-primitives.test.ts` covering all exported functions with both valid and invalid inputs.

## Constraints

- Follow the pattern from `src/core/daemon/daemon-state.test.ts`
- All exports must be tested: 12 pure functions plus `WorkflowDefinitionError`

## Done When

- `src/core/workflow/validation-primitives.test.ts` exists and all tests pass
- `npm test` passes
