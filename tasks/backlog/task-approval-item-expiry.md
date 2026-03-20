---
id: task-approval-item-expiry
title: Auto-expire stale pending approval items
status: backlog
priority: p2
area: approval
summary: Pending approval items in the queue have no expiry. A tool call queued days ago could be inadvertently approved long after context is lost. Add configurable expiry so old pending items are auto-rejected with a clear reason.
created_at: 2026-03-20
updated_at: 2026-03-20
---

## Problem

`ApprovalQueue` stores pending items indefinitely. In autonomous operation the daemon runs continuously; if an operator never responds to a notification, the pending items accumulate. A stale item approved much later could execute a tool call whose context is completely different from when it was queued.

## Desired Outcome

- Pending approval items older than a configurable TTL (default: 24 hours) are automatically rejected with reason "expired".
- Expiry runs on a periodic sweep (e.g., every 10 minutes) or lazily on `list()` / `get()`.
- `kota approval list` shows the age of each pending item so operators know what they're reviewing.
- Expired items emit `approval.resolved` with `approved: false` so listeners (e.g., Telegram notification) can observe the expiry.

## Constraints

- TTL should be configurable in `.kota/config.json` (e.g., `approvalTtlMs`); hard-coded default of 24 hours is fine.
- Do not delete expired items immediately — mark them `status: "expired"` (new status) so they remain auditable.
- `ApprovalStatus` type must be extended to include `"expired"` without breaking existing `"pending" | "approved" | "rejected"` handling in `approval-cli.ts`.

## Done When

- Expired pending items are transitioned to `"expired"` status automatically.
- `kota approval list` reflects age and expired state.
- Tests cover expiry sweep logic and the new status transition.
