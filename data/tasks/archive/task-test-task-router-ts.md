---
status: done
---

# Add direct unit tests for task-router.ts

## Problem

`src/core/daemon/task-router.ts` classifies task descriptions into types (research, coding, data_analysis, writing, planning, debugging, automation) using pattern matching. There are no unit tests. Misrouting silently degrades scheduler behavior.

## Desired Outcome

A `task-router.test.ts` file covering the routing function with representative task strings for each task type, including ambiguous inputs and fallback behavior. Tests must be pure and deterministic (no LLM calls or I/O).

## Constraints

- Pure unit tests only; no mocks, no I/O
- No production code changes
- Follow the established vitest pattern

## Done When

- `task-router.test.ts` exists and passes
- Each supported task type has at least one positive and one negative test case
- Edge cases (ambiguous input, empty string, unknown type) are covered
