---
id: task-daemon-session-orphan-cleanup
title: Clean up orphaned daemon sessions from crashed or disconnected clients
status: backlog
priority: p3
area: reliability
summary: When kota serve dies without calling DELETE /sessions/:id, the daemon retains stale session entries indefinitely; GET /status reports phantom active sessions with no TTL-based cleanup path.
created_at: 2026-03-30T23:05:00Z
updated_at: 2026-03-30T23:05:00Z
---

## Problem

When a `kota serve` process (or any interactive session client) terminates without calling `DELETE /sessions/:id`, the daemon retains a stale session entry indefinitely. Over time, `GET /status` reports phantom active sessions that mislead operators and any monitoring that uses session count as a signal. There is currently no TTL or sweep mechanism for registered interactive sessions.

## Desired Outcome

The daemon periodically detects and removes sessions that have exceeded an idle TTL:
- Each session registration tracks a `lastSeenAt` timestamp, updated by any session-related API call
- A periodic sweep removes sessions where `now - lastSeenAt > idleTtlMs`
- Removed sessions emit a `session.unregistered` bus event (same as explicit deregistration) so SSE consumers see a clean update
- TTL and sweep interval are configurable in daemon config with sensible defaults (e.g., 5-minute idle TTL, 1-minute sweep)

## Constraints

- No changes required to `kota serve` or client registration behavior — timeout is enforced server-side only
- Must not affect active workflow agent sessions; those are daemon-internal and not registered via the external sessions API
- Match existing session registration and unregistration patterns in `daemon-control.ts` and the daemon handle

## Done When

- Sessions not seen within the configured TTL are automatically removed from the active session list
- `GET /status` no longer shows stale sessions after TTL expires without explicit deregistration
- `session.unregistered` (or a distinct `session.expired`) event fires for each cleaned-up session
- TTL and sweep interval are documented in `DAEMON-API.md`
- Unit test covers idle expiry and event emission
