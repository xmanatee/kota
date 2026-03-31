---
id: task-approval-expiry
title: Add configurable timeout for pending workflow approvals
status: backlog
priority: p3
area: runtime
summary: Pending approvals sit indefinitely by default, blocking workflow runs. A configurable expiry lets operators set maximum wait times after which approvals auto-expire and the run fails with a clear message.
created_at: 2026-03-31T03:26:11Z
updated_at: 2026-03-31T03:26:11Z
---

## Problem

When a workflow run requests operator approval, it blocks indefinitely waiting for a response. If the operator is unavailable for hours or days, the workflow run holds an active slot and there is no automatic signal that the run is stuck. There is no configurable timeout and no auto-expiry mechanism.

## Desired Outcome

- A `approvals.timeoutMs` config field (no default — backwards-compatible, existing behavior unchanged when omitted).
- When set, a pending approval that exceeds `timeoutMs` is automatically resolved as `"timeout"`.
- The workflow run waiting on the expired approval fails with a descriptive error: "Approval timed out after Xm".
- `kota approval list` shows a time-remaining column for timed approvals.
- The expired approval record has status `"timeout"` in approval history.

## Constraints

- Default behavior (no timeout) must be fully preserved — no change without explicit config.
- Prefer a timer set at approval creation time over a polling loop.
- No changes to the approval protocol or CLI contract beyond adding the `timeout` resolution status.
- Document the new config field alongside the existing approval docs.

## Done When

- `approvals.timeoutMs` accepted in kota config.
- A pending approval exceeding the timeout is automatically resolved as `"timeout"` and the waiting run fails with a clear message.
- `kota approval list` shows time remaining for timed approvals.
- Existing approval tests pass; at least one new test covers timeout expiry.
