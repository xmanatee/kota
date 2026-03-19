---
title: Add direct unit tests for validation-primitives.ts
---

`src/workflow/validation-primitives.ts` was extracted from `validation.ts` during a recent split and has no dedicated test file. It is only exercised indirectly through `validation.test.ts`.

The module exports 12 pure functions (`expectRelativePath`, `expectName`, `expectNonEmptyString`, `expectOptionalString`, `expectOptionalBoolean`, `expectOptionalInteger`, `expectOptionalPositiveNumber`, `expectOptionalStringArray`, `expectOptionalScalarFilter`, `expectOptionalObjectOrFunction`, `expectOptionalFunction`, `isPlainObject`) plus `WorkflowDefinitionError`. All are pure with no I/O dependencies — ideal for direct unit testing.

Add `src/workflow/validation-primitives.test.ts` covering all exported functions with both valid and invalid inputs, similar to the pattern in `src/scheduler/daemon-state.test.ts`.
