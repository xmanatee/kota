---
id: task-daemon-control-api-integration-tests
title: Extend daemon control API integration tests to cover approvals, tasks, and history
status: ready
priority: p3
area: testing
summary: src/scheduler/daemon-control.test.ts already covers auth, /status, /events, /workflow controls, and /webhooks end-to-end, but GET/POST /approvals, GET /tasks, GET /workflow/history, and session-related routes have no test coverage.
created_at: 2026-03-30T18:46:25Z
updated_at: 2026-03-30T21:20:00Z
---

## Problem

`src/scheduler/daemon-control.test.ts` provides solid HTTP integration coverage for:
auth enforcement, `GET /status`, `GET /workflow/status`, workflow control routes
(`POST /workflow/pause`, `POST /resume`, `POST /abort`, `POST /reload`),
`GET /events` SSE, and `POST /webhooks/:name`.

The following critical-path endpoints have no test coverage:

- `GET /workflow/history` and `GET /workflow/history/:id` — run history detail
- `GET /approvals`, `POST /approvals/:id/approve`, `POST /approvals/:id/reject`
- `GET /tasks`, `POST /tasks/:id/move`

Regressions in these endpoints are caught only at runtime by operator-facing clients.

## Desired Outcome

The existing `daemon-control.test.ts` is extended with `describe` blocks for each
missing endpoint, using the same `makeHandle()` stub pattern already in place.

## Constraints

- Extend `src/scheduler/daemon-control.test.ts` — do not create a separate file.
- Use the existing `makeHandle()` + `fetchWithToken()`/`fetchNoToken()` helpers.
- Each new block needs at least one success case and one auth-failure case.
- Keep tests fast — no process spawning; inject stubs via `makeHandle()`.

## Done When

- `GET /workflow/history` and `GET /workflow/history/:id` are covered.
- `GET /approvals`, `POST /approvals/:id/approve`, `POST /approvals/:id/reject` are covered.
- `GET /tasks` and `POST /tasks/:id/move` are covered.
- All new tests pass alongside the existing suite.
- `docs/DAEMON-API.md` notes the test file location.
