---
id: task-complete-daemon-backed-live-workflow-surface
title: Route workflow trigger through daemon API
status: done
priority: p1
area: runtime
summary: Control commands (status, pause, resume, abort, reload) now use the daemon API. The remaining gap is workflow triggering — `kota workflow trigger` and the HTTP server's `POST /api/workflow/trigger` still write to `.kota/workflow-state.json` directly instead of routing through the daemon when it is running.
created_at: 2026-03-27T21:30:00Z
updated_at: 2026-03-27T21:48:29Z
---

## Problem

`kota workflow trigger` uses `WorkflowRunStore` directly, writing to
`.kota/workflow-state.json` regardless of whether a daemon is running. The
HTTP server's `POST /api/workflow/trigger` route does the same. The daemon
never sees or validates these enqueue requests, so it can't enforce cooldowns,
de-dupe, or emit queue-change events consistently.

## Desired Outcome

Both `kota workflow trigger` and `POST /api/workflow/trigger` detect a running
daemon and route through its control API. Standalone mode (no daemon) continues
to write to `.kota/workflow-state.json` as today.

## Constraints

- Keep standalone non-daemon flows working where explicitly intended (`kota run` is standalone by design).
- Do not add a second live control protocol or a parallel server path.
- Preserve `.kota/` files as persistence and audit evidence.

## Done When

- `kota workflow trigger` calls the daemon control API when a daemon is reachable, falls back to direct file write when offline.
- `POST /api/workflow/trigger` in `server-routes.ts` routes through the daemon when running (same pattern as other control commands).
- Tests cover the daemon-backed trigger path.
