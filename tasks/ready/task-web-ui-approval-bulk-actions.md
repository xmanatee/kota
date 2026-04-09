---
id: task-web-ui-approval-bulk-actions
title: Add bulk approve-all and reject-all buttons to the web UI approvals panel
status: ready
priority: p3
area: web-ui
summary: The CLI has `kota approval approve-all` and `kota approval reject-all` with optional risk filters, but the web UI approval panel has no bulk action. Operators reviewing a backlog of pending approvals must click each one individually.
created_at: 2026-04-09T00:30:00Z
updated_at: 2026-04-09T06:19:00Z
---

## Problem

When a workflow produces a burst of tool calls that all need approval — for example a
filesystem-heavy builder run — operators face a long queue in the web UI with no way
to clear it in bulk. The CLI offers `kota approval approve-all --risk moderate` but
the web UI approval panel has only per-item Approve/Reject buttons.

## Desired Outcome

The approvals panel gains two bulk action buttons at the top:
- **Approve All** — calls `POST /api/approvals/approve-all`
- **Reject All** — calls `POST /api/approvals/reject-all`

Both buttons show a confirmation step (count of items affected) before executing.
After success, the approval list refreshes automatically.

## Constraints

- Server-side: add `POST /api/approvals/approve-all` and `POST /api/approvals/reject-all`
  routes to `src/server/approval-routes.ts` and wire them in `src/server/server-routes.ts`.
  The routes delegate to `queue.approveAll()` / `queue.rejectAll()` (add these methods to
  `ApprovalQueue` in `src/extensions/approval-queue/queue.ts`). Daemon control API should
  also expose these via `DaemonControlServer` in `src/scheduler/daemon-control.ts`.
- Confirmation is inline (a brief "Approve 4 items? Confirm" reveal), not a modal.
- Buttons are hidden when the approval list is empty.
- Follows the existing `client-approvals.ts` pattern; no new module needed unless
  the file approaches the size limit.

## Done When

- Approve All and Reject All buttons appear in the approvals panel when items are pending.
- Each shows a confirmation reveal before executing.
- After execution, the panel refreshes and shows the updated (empty) list.
- Existing approval flow tests pass; a unit test covers the new button render path.
