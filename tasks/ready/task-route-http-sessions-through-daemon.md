---
id: task-route-http-sessions-through-daemon
title: Route HTTP server session management through the daemon
status: ready
priority: p2
area: runtime
summary: kota serve starts its own scheduler, event bus, and SessionPool — a parallel runtime separate from the daemon. Routing the HTTP server's session management through the daemon creates one unified runtime host and eliminates the dual-process-state problem.
created_at: 2026-03-30T01:00:00Z
updated_at: 2026-03-30T15:34:00Z
---

## Problem

`server.ts` (`kota serve`) boots its own `EventBus`, `Scheduler`, and
`SessionPool` independently of the daemon. When both `kota daemon` and
`kota serve` are running, there are two live runtime states: the daemon owns
workflows and stores, and the server owns interactive sessions. There is no
registry of interactive sessions visible from the daemon, and the server
does not use the daemon's scheduler or event bus.

`ARCHITECTURE.md` names this as the remaining gap: "The HTTP server's session
management (SessionPool) is still a parallel runtime entry point separate from
the daemon. The next step is routing the HTTP server's session management
through the daemon so there is one unified runtime host."

## Desired Outcome

When the daemon is running, `kota serve` connects to it as a client rather
than starting a second runtime. Interactive sessions are registered in the
daemon so `GET /status` can show them alongside workflow active runs.
The daemon becomes the single source of truth for all live KOTA state.

## Constraints

- The daemon control API is the integration point; do not introduce XPC or
  file-based side channels.
- Standalone `kota serve` (no daemon running) must continue to work for
  development use; the session pool and local scheduler are the fallback.
- Do not require the daemon to own interactive session message flow directly;
  session routing can remain in the server process as long as the daemon knows
  the sessions exist.
- Existing server and session tests must pass after the change.

## Done When

- `kota serve` does not start its own scheduler when the daemon is running.
- Active interactive sessions appear in daemon `GET /status` output alongside
  workflow active runs.
- `kota serve` falls back to standalone mode when no daemon is detected.
- `ARCHITECTURE.md` "Current To Target" section is updated to mark this step
  complete.
