---
id: task-fix-workflow-routes-trigger-test
title: Fix workflow-routes trigger test returning 409 instead of 200
status: ready
priority: p1
area: testing
created_at: 2026-03-27T23:20:00Z
updated_at: 2026-03-27T23:20:00Z
---

## Problem

The test "handleWorkflowTrigger > enqueues a workflow run and returns ok" in `src/server/workflow-routes.test.ts:251` returns HTTP 409 (Conflict) instead of the expected 200. This single failure has blocked 3 consecutive autonomous builder and improver runs (runs ending at 23:09, 23:02, and earlier). The handler returns 409 when it sees the workflow already in `pendingRuns`, which means test state is leaking across cases — the store is not being reset cleanly before this test executes.

## Desired Outcome

The test passes. All 4958 tests in the suite pass with no failures. The fix correctly isolates test state so that each test starts with a clean `WorkflowRunStore`.

## Constraints

- Do not change production behavior; only fix test isolation.
- If the 409 path is genuinely correct under some new condition introduced by the daemon-client split (commit b458c96), update the test expectation with a clear comment explaining why — do not mask a real regression.
- Do not add production flags or test-only hooks to production code. Use proper store reset, mock, or in-memory factory patterns in the test.

## Done When

- `src/server/workflow-routes.test.ts` passes with 0 failures.
- `npm test` (or equivalent) exits clean with all previously passing tests still passing.
