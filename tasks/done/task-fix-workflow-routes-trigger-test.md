---
id: task-fix-workflow-routes-trigger-test
title: Fix workflow-routes trigger test returning 409 instead of 200
status: done
priority: p1
area: testing
summary: Resolved by making workflow route handlers use explicit daemon-client injection instead of defaulting to the live daemon from process cwd, which restored test isolation and removed the 409/200 failure.
created_at: 2026-03-27T23:20:00Z
updated_at: 2026-03-28T00:00:00Z
---

Resolved more cleanly than the original one-line test patch: the route handler
no longer reaches out to the live daemon by default, and the HTTP server path
injects the daemon client explicitly.

## Problem

The test "handleWorkflowTrigger > enqueues a workflow run and returns ok" in
`src/server/workflow-routes.test.ts:251` returns HTTP 409 instead of 200.

Root cause (confirmed by reading the code): `handleWorkflowTrigger` has a
default parameter `client: DaemonControlClient | null = DaemonControlClient.fromStateDir()`.
`fromStateDir()` reads `.kota/daemon-control.json` from `process.cwd()`, which
is the live project root where the autonomous daemon is running. The test omits
the `client` argument, so the function uses the real running daemon as its
client. The running daemon reports "builder" as already queued, so the handler
returns 409.

The store reset (`beforeEach` creates a fresh `WorkflowRunStore` in a temp dir)
is fine — the store is not the problem. The problem is the function's default
parameter reaching out to the live daemon at test time.

This single failure has blocked consecutive autonomous builder and improver runs.

## Desired Outcome

The test passes. All tests in the suite pass with no failures.

## Constraints

- Do not change production behavior; only fix test isolation.
- The fix is a one-line change: pass `null` as the 4th argument in the
  "enqueues a workflow run and returns ok" test. This test is specifically
  exercising the standalone / no-daemon path, so `null` is the correct and
  semantically accurate value. Verify the other `handleWorkflowTrigger` tests
  that omit the client arg (e.g. "returns 400 for missing name") are also safe
  — name validation happens before the client check, so they should be fine, but
  confirm.
- Do not add production flags or test-only hooks to production code.

## Done When

- `src/server/workflow-routes.test.ts` passes with 0 failures.
- `npm test` (or equivalent) exits clean with all previously passing tests still passing.
