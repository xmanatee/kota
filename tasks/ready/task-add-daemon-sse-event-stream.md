---
id: task-add-daemon-sse-event-stream
title: Add SSE live event stream to the daemon control API
status: ready
priority: p2
area: runtime
summary: The daemon control API is purely poll-based today. DAEMON-CLIENTS.md calls for SSE for live status, run events, and streamed agent output. Adding a /events SSE endpoint would let CLI, web, and native clients receive real-time workflow events without polling.
created_at: 2026-03-27T22:00:00Z
updated_at: 2026-03-27T21:48:29Z
---

## Problem

The daemon control API exposes only synchronous JSON endpoints (`GET /status`,
`GET /workflow/status`, `POST /workflow/pause`, `POST /workflow/resume`). There
is no push channel.

Clients that want live updates must poll `/status` repeatedly. That is fine for
a CLI status bar, but it is the wrong model for real-time web UI, native desktop
widgets, and future mobile clients. `DAEMON-CLIENTS.md` explicitly calls for
SSE as the live event mechanism across all client types.

The HTTP server already has SSE for session chat and run log streaming, but
those are server-side pipes. The daemon has no equivalent. Clients connected
to the daemon cannot receive workflow start/complete events, run progress, or
step output without a separate polling loop.

## Desired Outcome

The daemon control API exposes a `GET /events` SSE endpoint. When a client
connects, it receives a stream of daemon events — at minimum: workflow started,
workflow completed, step started, step completed, and queue changed. The
`DaemonControlClient` gains an `events()` method that returns an async iterable
or EventSource-compatible stream.

Server routes that currently poll `/status` for live workflow state can switch
to subscribing to the SSE stream instead.

## Constraints

- The SSE endpoint lives in `DaemonControlServer` — not added to the HTTP
  server's routes.
- Events must be typed and stable enough for external clients to consume.
- Do not replicate the full agent-output streaming here — step-level events are
  sufficient; per-token streaming stays in the HTTP session/run-detail routes.
- Keep the polling fallback working; SSE is additive, not a replacement for
  `/status`.

## Done When

- `GET /events` on the daemon control server emits `workflow.started`,
  `workflow.completed`, `workflow.step.completed`, and `queue.changed` events
  as Server-Sent Events.
- `DaemonControlClient` exposes a method to subscribe to the event stream.
- `DAEMON-API.md` documents the new endpoint and event types.
- At least one existing polling path (e.g., server workflow status polling) is
  updated to use the SSE stream.
