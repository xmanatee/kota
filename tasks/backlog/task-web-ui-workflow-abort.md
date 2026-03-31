---
id: task-web-ui-workflow-abort
title: Add abort active run control to the web UI dashboard
status: backlog
priority: p3
area: operator-ux
summary: The web UI dashboard lets operators pause and resume workflow dispatch but has no way to abort an actively running workflow. Operators who need to stop a run mid-flight must switch to the terminal to run kota workflow abort.
created_at: 2026-03-31T01:59:40Z
updated_at: 2026-03-31T01:59:40Z
---

## Problem

The web UI workflow controls panel exposes pause and resume, but not abort. The
daemon control API already has `POST /workflow/abort` (via `DaemonControlClient.abort()`),
and the CLI exposes `kota workflow abort`. The server layer, however, has no proxy
route at `POST /api/workflow/abort`, so the web UI cannot reach the abort path.

An operator watching an active run in the dashboard — a stuck builder, an
unexpectedly expensive improver run — cannot abort it without switching to a terminal.

## Desired Outcome

- A `POST /api/workflow/abort` proxy route added to `server-routes.ts`, following the
  same pattern as `/api/workflow/pause` and `/api/workflow/resume`.
- A `handleWorkflowAbort` handler added to `workflow-routes.ts`.
- An "Abort" button added to the workflow controls panel in the web UI (shown
  only when at least one run is active).
- The abort button is disabled after being clicked and updates the run list on success,
  consistent with the pause/resume button pattern.

## Constraints

- Abort is destructive; the button should require confirmation (e.g., `confirm()` or
  a disabled-then-confirm-click pattern) before calling the endpoint.
- No new daemon API changes — `POST /workflow/abort` already exists on the daemon
  control server.
- When no daemon is running, the server should return `503 Daemon not running`,
  consistent with pause/resume behavior.
- Follow the existing route handler pattern: `handleWorkflowAbort(res, client)` in
  `workflow-routes.ts`, registered in `server-routes.ts`.

## Done When

- `POST /api/workflow/abort` is handled by the server and proxied to the daemon.
- The web UI workflow controls panel shows an abort button when active runs exist.
- Clicking abort (with confirmation) calls the endpoint and refreshes the run list.
- Handler has basic test coverage following the pause/resume test pattern.
