---
id: task-test-validation-primitives
title: Add direct unit tests for validation-primitives.ts
status: done
priority: p2
area: testing
summary: Add a dedicated test file for src/workflow/validation-primitives.ts covering all 12 exported functions and WorkflowDefinitionError.
created_at: 2026-03-19
updated_at: 2026-03-19
---

## Problem

`src/workflow/validation-primitives.ts` was extracted from `validation.ts` during a recent split and has no dedicated test file. It is only exercised indirectly through `validation.test.ts`.

## Desired Outcome

A dedicated `src/workflow/validation-primitives.test.ts` covering all exported functions with both valid and invalid inputs.

## Constraints

- Follow the pattern from `src/scheduler/daemon-state.test.ts`
- All exports must be tested: 12 pure functions plus `WorkflowDefinitionError`

## Done When

- `src/workflow/validation-primitives.test.ts` exists and all tests pass
- `npm test` passes
