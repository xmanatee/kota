---
id: task-web-ui-run-cancel-button
title: Add cancel button for queued runs in the web UI
status: backlog
priority: p3
area: operator-ux
summary: The daemon now exposes DELETE /workflow/runs/:id to cancel queued runs, and the CLI has kota workflow cancel, but the web UI run history panel has no cancel action. Operators who want to cancel a queued run must use the CLI.
created_at: 2026-03-31T17:52:00Z
updated_at: 2026-03-31T17:52:00Z
---

## Problem

`DELETE /workflow/runs/:id` was added to cancel queued (pending) runs before they start.
The CLI exposes this via `kota workflow cancel <run-id>`. However, the web UI run history
panel has no cancel button. Operators managing runs from the browser must fall back to the
CLI for this action, breaking the expected operator workflow.

## Desired Outcome

The web UI run history panel shows a "Cancel" button next to queued runs. Clicking it
calls the server-side cancel route, which proxies to the daemon control API, and removes
the run from the list (or updates its status to `cancelled` inline). The button is only
visible for runs with `status: "pending"` or `"queued"`.

## Constraints

- Follow the existing web UI client pattern in `src/web-ui/client-workflows.ts`.
- Add a server route in `src/server/workflow-run-routes.ts` that calls
  `daemonClient.cancelRun(runId)` — `DaemonClient.cancelRun` already exists.
- The cancel button must not appear for active, completed, or failed runs.
- On a `404` or `409` response, show a brief inline error message (run not found /
  already active).
- No new dependencies.

## Done When

- Queued runs in the web UI run history panel have a visible "Cancel" button.
- Clicking cancel removes or updates the run entry without a full page reload.
- Active/completed runs show no cancel button.
- At least one server route unit test covers the cancel proxy path.
