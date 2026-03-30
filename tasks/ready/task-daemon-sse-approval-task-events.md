---
id: task-daemon-sse-approval-task-events
title: Emit SSE events for approval queue and task store mutations
status: ready
priority: p2
area: runtime
summary: The daemon SSE stream only emits workflow-lifecycle events. Approvals and task mutations are invisible to streaming clients, forcing mobile and macOS clients to poll these endpoints on a timer rather than react instantly.
created_at: 2026-03-30T18:07:52Z
updated_at: 2026-03-30T18:07:52Z
---

## Problem

`DaemonControlServer` offers an SSE stream (`GET /events`) but the event types it emits are limited to workflow lifecycle: `workflow.started`, `workflow.completed`, `workflow.step.completed`, and `queue.changed`. Approval arrivals and task-store mutations emit nothing to the stream.

Clients that need to surface pending approvals promptly — a mobile app showing a badge count, a macOS menu bar icon turning red — must poll `GET /approvals` on an interval. Polling is laggy, wastes bandwidth, and drains mobile battery. It also means clients can miss short-lived approval windows if the poll interval is too coarse.

## Desired Outcome

Two new event types on the SSE stream:

- `approval.changed` — emitted whenever an approval is added, approved, or rejected. Payload includes the pending approval count and the affected approval id.
- `task.changed` — emitted whenever the task store changes (task moved, created, or deleted). Payload includes queue counts by status.

Clients subscribed to `GET /events` can react to these immediately without polling. The existing poll-based code in `kota workflow list` (daemon API path) and any future client can add a streaming listener instead.

## Constraints

- Emit events via the existing `EventBus` → SSE fan-out path already used by workflow events; do not add a second push mechanism.
- Payload should be compact JSON: counts and affected IDs only — no full task or approval body.
- Do not break existing SSE consumers; new event types are additive.
- `GET /events` capability scope stays `read` — no scope changes needed.
- Document the two new event types in `docs/DAEMON-API.md` alongside the existing event catalog.

## Done When

- `approval.changed` SSE event is emitted on every approval queue mutation with pending count and approval id.
- `task.changed` SSE event is emitted on every task store write with queue counts by status.
- Both event types are documented in `docs/DAEMON-API.md`.
- Existing SSE event tests continue to pass; new events have at least one integration-level test.
