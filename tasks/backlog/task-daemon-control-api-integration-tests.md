---
id: task-daemon-control-api-integration-tests
title: Add integration tests for the daemon control API
status: backlog
priority: p3
area: testing
summary: DaemonControlServer exposes a growing HTTP+JSON+SSE API used by the CLI, web dashboard, and planned mobile/desktop clients. No integration tests verify the HTTP interface end-to-end, leaving regressions to be caught only at runtime.
created_at: 2026-03-30T18:46:25Z
updated_at: 2026-03-30T18:46:25Z
---

## Problem

`DaemonControlServer` exposes a multi-endpoint control API used by every KOTA client surface:

- `GET /status` — daemon health, active runs, sessions
- `GET /workflow/history` — run history with step detail
- `POST /pause`, `POST /resume` — daemon control
- `GET /approvals`, `POST /approvals/:id/approve`, `POST /approvals/:id/reject`
- `GET /tasks`, `POST /tasks/:id/move`
- `GET /events` — SSE stream for real-time updates

As mobile, macOS, and web clients are built against this API, regressions in any
endpoint become cross-surface failures. Today there are no integration tests that
start a real server and verify HTTP response shape, status codes, auth enforcement,
and SSE event delivery end-to-end.

## Desired Outcome

An integration test suite that spins up a `DaemonControlServer` on a random port
and drives it with real HTTP requests, asserting on response shape, status codes,
headers, and SSE stream behavior.

## Constraints

- Use vitest and the existing test infrastructure.
- Start a real HTTP server — do not mock the HTTP layer itself.
- Use minimal stub implementations of underlying stores (approval queue, task store,
  history store) rather than mocking individual route handlers.
- Cover the critical path at minimum: `GET /status`, `GET /workflow/history`,
  `GET /approvals`, `POST /approvals/:id/approve`, `GET /tasks`, `GET /events`.
- Auth tests: requests missing or providing a bad `X-Kota-Token` must return 401.
- SSE test: connect to `GET /events`, emit a bus event, verify the client receives it.
- Keep test setup fast — no full daemon process; construct `DaemonControlServer`
  directly with injected dependencies.

## Done When

- Integration tests exist covering all listed critical-path endpoints.
- Each covered endpoint has at least one success case and one auth-failure case.
- `GET /events` test verifies SSE connect and receipt of at least one emitted event.
- All tests pass in CI.
- `docs/DAEMON-API.md` notes the integration test location.
