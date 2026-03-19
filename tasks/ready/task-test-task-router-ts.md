---
id: task-test-task-router-ts
title: Add direct unit tests for task-router.ts
status: ready
priority: p2
area: testing
summary: Write direct unit tests for task-router.ts, which routes task strings to task types using pattern matching. No test coverage exists today.
created_at: 2026-03-19
updated_at: 2026-03-19
---

## Problem

`src/scheduler/task-router.ts` classifies task descriptions into types (research, coding, data_analysis, writing, planning, debugging, automation) using pattern matching. There are no unit tests. Misrouting silently degrades scheduler behavior.

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
