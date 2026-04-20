---
id: task-reregister-serve-sessions-after-daemon-restart
title: Re-register serve-owned sessions with the daemon after a daemon restart
status: done
priority: p3
area: daemon
summary: The serve process registers each session with the daemon once at creation via POST /sessions/register; after a daemon restart the daemon's advisory registry is empty until the next per-session call. Serve sessions survive in the serve process, but daemon clients (status, web dashboard) cannot see them. Close the gap with a serve-side re-registration handshake.
created_at: 2026-04-20T01:45:45.000Z
updated_at: 2026-04-20T04:18:28.495Z
---

## Problem

`src/core/server/server-routes.ts` calls
`ctx.daemonClient.registerSession(...)` from `POST /api/sessions` and
`POST /api/chat` at session-creation time. There is no re-registration
loop. If the daemon crashes and restarts after the serve process has
already created sessions, the daemon's in-memory `sessions` map is
empty; the serve process still owns the live `AgentSession` instances
but the daemon does not know they exist.

The practical effect: daemon-facing clients (`kota status`, the web
dashboard's session list, channel consumers that filter on sessions)
see zero sessions even though conversations are still active in the
serve process. Operators only notice when they try to act through the
daemon on a session that "does not exist."

The recoverability audit in `src/core/daemon/AGENTS.md` records this
as a live gap rather than a deliberate loss.

## Desired Outcome

- The serve process detects a daemon control-file change (new
  `startedAt` / new token) and re-registers every session it still
  owns, so the daemon's advisory registry converges to the serve's
  ground truth within a small bounded window.
- A missing daemon (control file removed) does not crash serve
  sessions. A returning daemon rebuilds the registry without operator
  intervention.
- `kota status` and the web dashboard session list reflect live serve
  sessions immediately after daemon restart, not only after the
  operator drives a new per-session action.
- `src/core/daemon/AGENTS.md` recoverability section is updated to
  move the serve-registered session registry out of the "gaps" list.

## Constraints

- No second event store. Reuse the existing control-API
  `POST /sessions/register` endpoint.
- Keep the serve process authoritative for serve-owned sessions. The
  daemon registry is advisory; the serve process owns the
  reconciliation direction.
- No polling storm: the serve process should watch the control file
  for changes (or use a single infrequent heartbeat) rather than
  retrying on every turn.
- No test-only production flag. The re-registration path is exercised
  by a real daemon-restart scenario.

## Done When

- The serve process re-registers all live sessions with the daemon
  after it detects a daemon startup that post-dates its last
  registration.
- A focused test simulates a daemon restart while a serve session is
  alive and asserts the daemon's session list reflects the serve
  session within the expected window.
- `src/core/daemon/AGENTS.md` recoverability section reflects the
  closed gap.
