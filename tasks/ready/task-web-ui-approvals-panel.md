---
id: task-web-ui-approvals-panel
title: Add approvals management panel to web UI dashboard
status: ready
priority: p2
area: operator-ux
summary: Pending guardrail approvals can only be resolved via CLI or Telegram; operators watching the web dashboard must context-switch to a terminal to unblock autonomous runs. All required infrastructure (SSE approval.changed, GET/POST /approvals endpoints) already exists.
created_at: 2026-03-30T23:05:00Z
updated_at: 2026-03-30T23:05:00Z
---

## Problem

Pending approval requests (guardrail policy escalations) can only be resolved via `kota approval` CLI commands or Telegram. The web dashboard has no visibility into the approval queue, so operators monitoring via browser must switch to a terminal to approve or reject pending actions. This blocks autonomous runs from proceeding when the operator is watching the web UI.

## Desired Outcome

The web UI dashboard includes an approvals panel that:
- Lists pending approvals (tool name, risk level, rationale, requesting run, timestamp, expiry if set)
- Allows approve and reject with a single confirmation click per item
- Updates in real-time via SSE when `approval.changed` events arrive (new items, resolutions, expirations)
- Shows an empty state (not hidden) when no approvals are pending

## Constraints

- Use existing SSE client wiring — `approval.changed` is already forwarded by the daemon SSE handler
- Use existing daemon API endpoints: `GET /approvals`, `POST /approvals/:id/approve`, `POST /approvals/:id/reject`
- No new REST endpoints required; all needed infrastructure already exists
- Existing CLI and Telegram approval paths must continue to work unchanged
- No confirmation modal required; a single approve/reject button per row is sufficient

## Done When

- Approvals panel is visible on the web dashboard
- Pending approvals list correctly from `GET /approvals` on page load
- Approve and reject actions call the correct daemon API endpoints and update the list immediately
- SSE-driven `approval.changed` events refresh the panel without full page reload
- Panel renders an empty state when no approvals are pending
