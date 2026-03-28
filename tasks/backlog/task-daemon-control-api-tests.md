---
id: task-daemon-control-api-tests
title: Add integration tests for daemon control API endpoints
status: backlog
priority: p2
area: reliability
summary: The daemon control server (daemon-control.ts) is new critical infrastructure with no dedicated tests. It handles workflow triggers, status queries, and pause/resume — all paths that autonomous workflows depend on. Add integration tests covering the key HTTP endpoints.
created_at: 2026-03-28T01:20:00Z
updated_at: 2026-03-28T01:20:00Z
---

## Problem

`src/scheduler/daemon-control.ts` was added as the daemon's loopback HTTP
control API (commits 38c5e86, b5b787a). It handles POST `/trigger`, GET
`/status`, GET `/workflows/:id`, POST `/pause`, POST `/resume`, and similar
endpoints. The CLI routes control commands through this API when a daemon is
running.

There are no tests for `daemon-control.ts`. The surrounding scheduler code
(`daemon.test.ts`, `daemon-state.test.ts`, etc.) does not cover HTTP routing,
request parsing, or response shapes. A bug in the control server breaks CLI
daemon-client mode silently.

## Desired Outcome

Integration tests covering the daemon control API's key endpoints: status,
workflow trigger, workflow list, pause, and resume. Tests should spin up a
real `DaemonControlServer` instance, make HTTP requests, and assert response
shapes and status codes.

## Constraints

- No test-only production flags or override hooks.
- Tests should use the same patterns as existing scheduler test files.
- Cover happy-path and basic error cases (unknown route, malformed body).

## Done When

- A test file `src/scheduler/daemon-control.test.ts` exists with passing tests.
- Coverage includes: `/status`, `/trigger`, `/workflows`, `/pause`, `/resume`.
- All existing tests still pass.
