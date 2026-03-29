---
id: task-make-http-server-daemon-backed
title: Make the HTTP server use the daemon as its runtime backend
status: ready
priority: p1
area: api
summary: The KOTA HTTP server and the daemon are still separate runtime entry points. The server reads live state from .kota/ files and its own in-process workflow state rather than routing through the daemon API. Making the server daemon-backed completes migration step 4 in DAEMON-CLIENTS.md.
created_at: 2026-03-27T22:43:00Z
updated_at: 2026-03-29T22:31:00Z
---

## Problem

DAEMON-CLIENTS.md migration step 4 is "Make the web/server surface daemon-backed
instead of a parallel runtime." Today `kota serve` starts its own session pool,
reads `.kota/` files for workflow state, and runs alongside (or instead of)
the daemon rather than connecting to it. This means:

- The server and daemon can diverge on live session and workflow state.
- Web UI clients get a stale or incomplete picture when the daemon is actually
  in charge.
- Adding live SSE events to the server requires duplicating event wiring that
  already exists in the daemon.

The daemon control API already proxies workflow status/pause/resume/abort to
the daemon. What remains is making the session layer, live workflow events, and
all live status queries flow through the daemon rather than a parallel runtime.

## Desired Outcome

`kota serve` operates as a daemon client for live state: it connects to the
running daemon for session registry, workflow status, and event streams rather
than maintaining its own parallel runtime context. When the daemon is not running,
the server can still serve a degraded read-only view from `.kota/` artifacts.

## Constraints

- Do not remove standalone `kota serve` (without daemon) entirely — preserve
  the degraded/read-only fallback so operators can still browse run history
  without a running daemon.
- Session pool management should move to the daemon; the server should route
  interactive session requests through the daemon's session registry.
- The SSE event stream (`GET /events`) is now complete and available via `DaemonControlClient`. Use it for push events from the daemon to the server.
- Do not introduce a web-specific control protocol — reuse `DaemonControlClient`
  and the `GET /events` SSE endpoint.

## Done When

- `kota serve` connects to the running daemon for live workflow and session state
  instead of reading `.kota/` files directly for control.
- The web UI receives live workflow events via the daemon SSE stream rather than
  polling server-side state.
- `DAEMON-CLIENTS.md` migration step 4 is marked complete.
- Standalone server mode (no daemon) degrades gracefully to read-only run artifact browsing.
