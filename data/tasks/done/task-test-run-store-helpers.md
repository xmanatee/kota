---
id: task-test-run-store-helpers
title: Add direct unit tests for run-store-helpers.ts
status: done
priority: p1
area: testing
summary: Add a dedicated test file covering all pure functions in src/core/workflow/run-store-helpers.ts.
created_at: 2026-03-19
updated_at: 2026-03-19
---

## Problem

`src/core/workflow/run-store-helpers.ts` contains several pure functions with no dedicated test file, leaving validation branches and serialization behavior uncovered.

## Desired Outcome

A `src/core/workflow/run-store-helpers.test.ts` file covering all validation paths for `assertWorkflowRuntimeState`, `assertWorkflowRunMetadata`, `safeJsonStringify`, `buildWorkflowSnapshot`, and `isPlainObject`.

## Constraints

- Follow the pattern from `src/core/workflow/validation-primitives.test.ts`.
- No mocking of I/O — all target functions are pure.

## Done When

- All branches in the five functions are exercised.
- `npm test` passes cleanly.
