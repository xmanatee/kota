---
status: done
---

# Split daemon-control.ts into focused route modules

## Problem

`src/core/daemon/daemon-control.ts` is 653 lines and handles HTTP dispatch, approval endpoints, session endpoints, workflow control endpoints, history endpoints, task endpoints, and the Prometheus metrics endpoint. The file has grown with each new endpoint and now mixes routing infrastructure with per-area handler logic, making it hard to navigate and extend.

## Desired Outcome

- Extract route handlers into focused sibling modules under `src/core/daemon/`:
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
- Update `src/core/daemon/AGENTS.md` to list the new modules.

## Done When

- `daemon-control.ts` is ≤300 lines.
- Each extracted module is ≤300 lines.
- All existing tests pass.
- `src/core/daemon/AGENTS.md` reflects the new file layout.
