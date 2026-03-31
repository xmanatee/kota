---
id: task-split-daemon-control-ts
title: Split daemon-control.ts into focused route modules
status: done
priority: p3
area: refactor
summary: daemon-control.ts is 653 lines, more than double the 300-line limit. The file handles HTTP parsing, routing, approval commands, session registration, workflow control, history, and metrics — all mixed together. Splitting into route modules would make each area easier to extend independently.
created_at: 2026-03-31T08:16:57Z
updated_at: 2026-03-31T08:31:48Z
---

## Problem

`src/scheduler/daemon-control.ts` is 653 lines and handles HTTP dispatch, approval endpoints, session endpoints, workflow control endpoints, history endpoints, task endpoints, and the Prometheus metrics endpoint. The file has grown with each new endpoint and now mixes routing infrastructure with per-area handler logic, making it hard to navigate and extend.

## Desired Outcome

- Extract route handlers into focused sibling modules under `src/scheduler/`:
  - `daemon-control-approvals.ts` — approval list, approve, reject endpoints.
  - `daemon-control-sessions.ts` — session register/unregister endpoints.
  - `daemon-control-workflow.ts` — workflow pause/resume/abort/reload/trigger/status endpoints.
  - `daemon-control-history.ts` — history list/show endpoints.
  - `daemon-control-metrics.ts` — Prometheus metrics endpoint.
- `daemon-control.ts` shrinks to the HTTP server wiring and route dispatch only (≤300 lines).
- All exported types that other modules import remain in `daemon-control.ts` or re-exported from it.

## Constraints

- No behavior changes — this is a pure structural refactor.
- All existing `daemon-control.test.ts` tests must pass without modification.
- Do not move or rename exported types in ways that break external imports.
- Update `src/scheduler/AGENTS.md` to list the new modules.

## Done When

- `daemon-control.ts` is ≤300 lines.
- Each extracted module is ≤300 lines.
- All existing tests pass.
- `src/scheduler/AGENTS.md` reflects the new file layout.
