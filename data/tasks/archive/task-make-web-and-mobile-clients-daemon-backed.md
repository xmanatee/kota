---
status: done
---

# Complete web operator dashboard and prepare mobile API contract

## Problem

Migration step 4 is complete: the workflow panel connects to the daemon via SSE
and falls back to polling when the daemon is offline. However, the other web
panels (History, Approvals, Tasks) still use standalone HTTP routes and file
access rather than querying the daemon as the source of truth. This leaves the
operator dashboard partially daemon-backed.

Additionally, there is no documented API contract for future mobile clients.
A mobile client needs to perform the same reads and actions the web dashboard
does — listing history, approving actions, managing tasks, watching workflow
status — over a single protocol.

## Desired Outcome

- All web dashboard panels (Workflow, History, Approvals, Tasks) read live
  state from the daemon API when the daemon is running.
- A `GET /api/sessions` or equivalent makes active session state visible to
  clients.
- The daemon API surface is sufficient for a thin mobile client to perform
  common operator actions.
- `ARCHITECTURE.md` "Current To Target" is updated to reflect the completed
  daemon/client migration.

## Constraints

- Do not introduce a web-only or mobile-only runtime path.
- Reuse the daemon control API rather than inventing client-specific
  live-state mechanisms.
- Standalone (no daemon) fallback must still work — do not break the offline
  case.
- `task-add-daemon-auth-and-capability-scopes` is complete — token auth and
  capability scopes are live. This task is unblocked.

## Done When

- Workflow, History, Approvals, and Tasks panels all use daemon API as source
  of truth when the daemon is running.
- The daemon's `/status` response or a new endpoint exposes active sessions.
- `ARCHITECTURE.md` Current To Target section is updated to reflect the
  completed migration.
- The native macOS menu bar and mobile client tasks can reference a stable,
  documented API contract rather than re-deriving it.
