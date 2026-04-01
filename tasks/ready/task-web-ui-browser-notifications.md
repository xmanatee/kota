---
id: task-web-ui-browser-notifications
title: Add browser push notifications for workflow events when the tab is unfocused
status: ready
priority: p3
area: operator-ux
summary: The web UI receives real-time workflow events via SSE but has no browser Notification API integration. Operators who leave the tab open in the background miss failure alerts and approval requests until they return to the tab.
created_at: 2026-03-31T17:30:00Z
updated_at: 2026-03-31T17:30:00Z
---

## Problem

The web UI uses an SSE stream to receive live events including `workflow.failure.alert`,
`approval.changed`, and `workflow.completed`. When these events arrive with the tab in the
background or minimized, there is no signal to draw the operator's attention. Operators
running unattended overnight workflows must manually check the UI to discover failures.

The Web Notifications API (`Notification`) is well-supported in all modern browsers and
lets web apps pop OS-level notifications when the tab is not focused.

## Desired Outcome

When the web UI receives a `workflow.failure.alert` or new `approval.changed` SSE event, and the
browser document is not currently visible (`document.visibilityState !== "visible"`), it requests
permission and fires a browser notification with:

- **Failure alert**: title "Workflow failed", body = workflow name and run ID.
- **New approval**: title "Approval required", body = approval description.

The feature is:
1. Opt-in: shown once via `Notification.requestPermission()` the first time the UI loads.
2. Gated on `document.visibilityState`; no notifications pop when the user is actively viewing the tab.
3. Clicking the notification focuses the browser tab.

## Constraints

- Pure client-side; no new server routes or backend changes.
- Use the standard browser `Notification` API; do not add a dependency.
- If permission is denied, fail silently — no error overlays or console spam.
- Keep changes inside existing `src/web-ui/` files; do not introduce a new module.
- Only fire for failure and approval events, not for every workflow completion.

## Done When

- A browser notification appears for `workflow.failure.alert` events when the tab is not focused.
- A browser notification appears when a new approval request arrives and the tab is not focused.
- No notifications fire when the tab is visible.
- Clicking a notification focuses the originating tab.
- Existing web UI tests pass.
