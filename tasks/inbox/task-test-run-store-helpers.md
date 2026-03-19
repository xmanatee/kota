---
title: Add direct unit tests for run-store-helpers.ts
---

`src/workflow/run-store-helpers.ts` contains several pure functions with no dedicated test file:

- `assertWorkflowRuntimeState` — validates the persisted workflow state shape; has many branches (completedRuns, pendingRuns, workflows map, optional active fields)
- `assertWorkflowRunMetadata` — validates a single run metadata record
- `safeJsonStringify` — handles circular references, BigInt, Function, Error, Map, Set
- `buildWorkflowSnapshot` — builds a serializable summary of a workflow definition
- `isPlainObject` — type-narrowing predicate

These are all pure (no I/O) and ideal for direct unit testing. Add `src/workflow/run-store-helpers.test.ts` covering all validation paths with both valid and invalid inputs, similar to the pattern in `src/workflow/validation-primitives.test.ts`.
