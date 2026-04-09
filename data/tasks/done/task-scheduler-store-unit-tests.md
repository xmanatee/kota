---
id: task-scheduler-store-unit-tests
title: Add direct unit tests for scheduler-store.ts
status: done
priority: p2
area: testing
summary: scheduler-store.ts has important cleanup logic (cap fired items to 20, remove cancelled items) with zero direct test coverage.
created_at: 2026-03-19T12:41:00Z
updated_at: 2026-03-19T12:41:00Z
---

## Problem

`src/scheduler/scheduler-store.ts` contains two exported functions — `loadFromFile` and `persistToFile` — with non-trivial logic that is completely untested:

- `persistToFile` trims the oldest fired items when the count exceeds 20 and strips all cancelled items before writing.
- `loadFromFile` handles missing files, corrupt JSON, and project mismatches.

## Desired Outcome

A `scheduler-store.test.ts` file that covers each of those behaviours with direct unit tests, following the same style as neighbouring test files.

## Constraints

- No test-only production flags.
- Tests must pass with `npm test`.

## Done When

- `src/scheduler/scheduler-store.test.ts` exists and all tests pass.
- `npm run typecheck`, `npm run lint`, and `npm test` all pass.
