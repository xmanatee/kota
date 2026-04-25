---
id: task-move-daemon-control-history-route-handlers-out-of-
title: Move daemon-control history route handlers out of core via controlRoutes
status: ready
priority: p2
area: architecture
summary: Migrate the /history, /history/:id daemon-control endpoints from src/core/daemon/daemon-control-history.ts into the history module via KotaModule.controlRoutes, mirroring the voice migration pattern, and add an import-guard test refusing reintroduction.
created_at: 2026-04-25T05:21:39.657Z
updated_at: 2026-04-25T05:21:39.657Z
---

## Problem

`src/core/daemon/daemon-control.ts` still hard-codes the `/history`,
`/history/:id` routes and dispatches them through
`src/core/daemon/daemon-control-history.ts`, even though the underlying
store has already been inverted behind a neutral `HistoryProvider`
protocol (commit `8f12be9e`) and the history module already owns the
`/api/history` surface plus the CLI. The `controlRoutes` seam landed
with the voice migration (commit `aa59e6f8`) so KOTA's recommended
pattern for module-owned control-plane endpoints is now in place — and
`src/core/daemon/AGENTS.md` explicitly names history alongside voice
and webhooks as a future application of that seam. Today the history
control routes are the most visible counter-example: file-backed store
in a module, HTTP route handlers in core, and a `getHistory` reference
that the core handler still knows about indirectly through `handle.*`
glue. The shape leaves the daemon control surface looking module-first
on paper but core-first in code.

## Desired Outcome

The `/history`, `/history/:id` daemon-control endpoints are contributed
by the `history` module through `KotaModule.controlRoutes`, exactly the
way the voice module contributes `/voice/transcribe` and
`/voice/synthesize`. `src/core/daemon/daemon-control-history.ts` is
deleted along with its route-scope and dispatch entries in
`daemon-control.ts`, and the `DaemonControlHandle` history methods that
existed only to feed those handlers are removed if the module
contribution lets them go. A new import-guard test refuses any future
reintroduction of `daemon-control-history*.ts` under `src/core/daemon/`.
The wire contract — bearer-token check, `read` vs `control` capability
scopes, response shapes, 404 on missing conversation — is preserved and
covered by a co-located `DaemonControlServer`-based test in the history
module, mirroring the voice module's pattern. Route-key collisions with
built-ins or with another module's contribution still throw at server
construction.

## Constraints

- Use the existing `KotaModule.controlRoutes` seam. Do not introduce a
  parallel registration path or a shadow router.
- Preserve the existing route paths (`GET /history`, `GET /history/:id`,
  `DELETE /history/:id`), capability scopes (`read` for the two GETs,
  `control` for the DELETE — match the current `daemon-control.ts`
  table), bearer-token gating, status codes, and response shapes
  (`{ conversations: ... }` for list, full record for get, `204 No
  Content` for delete, `404` for missing).
- The handler implementation must live once in the history module. If
  any glue is needed to share logic with the existing `/api/history`
  routes, factor it into one shared function in the module rather than
  duplicating between paths.
- Core must not import from `#modules/history/*`. The repo-wide guard
  in `src/core/agent-harness/no-module-imports-in-core.test.ts` already
  enforces this; do not weaken it. Add a dedicated import-guard test
  under `src/core/modules/` (or extend an existing one) that refuses any
  new `daemon-control-history*.ts` under `src/core/daemon/`, matching
  the voice migration's guard precedent.
- Remove `DaemonControlHandle` history methods once they are no longer
  needed by core. If something external still legitimately needs them
  (e.g. another core-resident caller), leave them and document why in
  the same change.
- Existing daemon-control client wrappers (`DaemonControlClient`) and
  any callers in CLI/web/native paths must continue to work unchanged.
  Adjust internal wiring if needed, but do not change the wire contract.
- Update `src/core/daemon/AGENTS.md` and `src/modules/history/AGENTS.md`
  so each describes the new seam location truthfully. Do not leave
  `daemon-control-history.ts` in the "internal subdomains" enumeration
  after removal.

## Done When

- `src/core/daemon/daemon-control-history.ts` is deleted.
- `src/core/daemon/daemon-control.ts` no longer references any
  history route, scope, or handler — the file's import list, the
  `ROUTE_SCOPES` table, and the dispatch switch are clean of
  `/history` entries.
- The history module declares the three routes through
  `KotaModule.controlRoutes` with the correct `capabilityScope` per
  method, and a co-located `DaemonControlServer`-based test exercises
  list/get/delete end-to-end against the registered routes.
- An import-guard test rejects any new `daemon-control-history*.ts`
  under `src/core/daemon/` — modeled on the voice migration's guard.
- The repo-wide `no-module-imports-in-core` guard still passes
  unmodified.
- `pnpm test` passes on the resulting branch with the new module-side
  test included.
- `src/core/daemon/AGENTS.md` and `src/modules/history/AGENTS.md`
  describe the migration's outcome accurately; no stale references to
  `daemon-control-history.ts` remain anywhere in the repo.

## Source / Intent

Owner direction throughout the architecture initiative has been
"minimal core, module-first" — voice (`aa59e6f8`), Claude-SDK executor
(`f3a1b444`), architect mode (`85bb9176`), and the `HistoryProvider`
inversion (`8f12be9e`) all moved capability out of `src/core/`. The
`controlRoutes` seam landed specifically so module-owned HTTP endpoints
no longer need to live in core. `src/core/daemon/AGENTS.md` names
history as one of the next natural applications. This task closes
that gap before it becomes a "we forgot why this was here" piece of
core debt.

## Initiative

Minimal-core, module-first architecture: every module-owned capability
should also own its operator-facing surfaces, including HTTP control
routes. Each migration like this one shrinks the core boundary and
makes the seam discoverable as the recommended pattern for any future
module contributing control-plane endpoints.

## Acceptance Evidence

- Diff showing `daemon-control-history.ts` deleted, `daemon-control.ts`
  cleaned of history entries, the history module's `KotaModule`
  definition gaining `controlRoutes`, and the new import-guard test.
- New module-side `DaemonControlServer` test covering list/get/delete
  including the `read`/`control` capability-scope split — pasted
  transcript or named test file in the run directory or PR body.
- `pnpm test` output (or relevant filtered subset) showing the new
  test green and the import-guard test green.
- Updated `src/core/daemon/AGENTS.md` and `src/modules/history/AGENTS.md`
  with the new seam wording.
