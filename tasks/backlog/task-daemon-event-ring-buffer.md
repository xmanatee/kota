---
id: task-daemon-event-ring-buffer
title: Add in-memory event ring buffer to expose recent daemon events via control API
status: backlog
priority: p3
area: runtime
summary: The daemon event bus emits events that SSE clients can subscribe to live, but there is no way to retrieve events that fired before a client connected. A ring buffer with a GET endpoint lets clients catch up on recent events without polling.
created_at: 2026-04-01T05:41:53Z
updated_at: 2026-04-01T05:41:53Z
---

## Problem

The daemon event bus (`src/event-bus.ts`) fires typed events — workflow lifecycle, approval, budget, attention — but these events are ephemeral. An SSE client that connects after a workflow completes misses the completion event entirely. The web UI and CLI have no way to query "what events fired in the last N minutes" without re-reading run artifact files.

This means:
- The web UI misses events that fired during a page reload.
- Operators connecting to `GET /events` after a burst of activity see no history.
- Notification extensions cannot replay recent events to a newly registered subscriber.

## Desired Outcome

An in-memory ring buffer (configurable size, default 500 events) that subscribes to all daemon bus events at startup and retains them in order. A new endpoint `GET /api/events?since=<timestamp>&limit=<n>` returns the buffered slice so clients can catch up after reconnecting.

The SSE stream (`GET /events`) optionally accepts a `?since=<timestamp>` query parameter that replays buffered events before switching to live streaming, enabling seamless reconnection.

## Constraints

- Ring buffer is in-memory only; no persistence required.
- Default buffer size of 500 events is sufficient; make it configurable via `daemon.eventBufferSize` config field.
- The `GET /api/events` endpoint requires the same read-scope auth as other daemon API routes.
- Do not change the event bus interface or event payload types.
- SSE reconnect replay is opt-in (client passes `?since=`) and must not block new events if the buffer is large.

## Done When

- Daemon maintains an in-memory ring buffer of recent events.
- `GET /api/events?since=<iso-timestamp>&limit=<n>` returns buffered events as JSON.
- `GET /events?since=<iso-timestamp>` replays buffered events before streaming live.
- Buffer size is configurable; default is 500.
- Unit test covers buffer eviction and the catch-up query.
- `docs/DAEMON-API.md` documents the new endpoint and SSE reconnect parameter.
