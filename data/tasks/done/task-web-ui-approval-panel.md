---
id: task-web-ui-approval-panel
title: Add approval queue panel to web UI
status: done
priority: p2
area: web-ui
summary: The approval queue exists and has a CLI interface, but pending approvals are invisible in the web UI. Adding a panel that lists pending approvals and lets users approve or reject them closes the loop for autonomous runs that require human sign-off.
created_at: 2026-03-20
updated_at: 2026-03-20
---

## Problem

When an autonomous workflow run generates a pending approval, the only way to see and action it is via the CLI (`kota approval list`, `kota approval approve <id>`). The web UI shows run status, tasks, and costs, but has no visibility into the approval queue. This means users monitoring via the web UI can miss blocking approvals.

## Desired Outcome

- A new approvals panel in the web UI shows all pending approvals with description, risk level, and age.
- Users can approve or reject individual items directly from the panel.
- The panel auto-refreshes on the same interval as other panels.
- Server routes `GET /api/approvals` and `POST /api/approvals/:id/approve` / `/reject` are added to expose the ApprovalQueue over HTTP.

## Constraints

- Server routes must reuse the existing `ApprovalQueue` singleton — no new storage.
- The web UI panel should be consistent in layout and style with the existing task queue and cost panels.
- Only show pending approvals; resolved/expired items are not needed in this view.
- Keep the server route file changes minimal — add approval routes to the appropriate existing routes file or create a dedicated `approval-routes.ts`.

## Done When

- `GET /api/approvals` returns the list of pending approvals.
- `POST /api/approvals/:id/approve` and `POST /api/approvals/:id/reject` act on the queue.
- The web UI renders a panel with pending approvals and functional approve/reject buttons.
- The panel refreshes automatically and shows an empty state when no approvals are pending.
- Tests cover the new server routes.
