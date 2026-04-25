---
id: task-move-apischedules-and-apinotifications-server-rout
title: Move /api/schedules and /api/notifications server routes into the scheduler module via KotaModule.routes
status: done
priority: p2
area: architecture
summary: Migrate the two scheduler-owned server routes out of core/server-routes.ts into a routes() contribution on the scheduler module, matching the recent /commands and /history server-route migrations.
created_at: 2026-04-25T08:13:50.648Z
updated_at: 2026-04-25T08:26:03.331Z
---

## Problem

`src/core/server/server-routes.ts` still hardcodes two scheduler-owned HTTP
routes:

- `GET /api/schedules` — returns `ctx.scheduler.pending()`.
- `GET /api/notifications` — opens an SSE stream on `ctx.hub` that emits
  `scheduler.getDue()` items.

These are capability-specific routes living in the core HTTP server. The local
`src/core/server/AGENTS.md` is explicit: "Capability-specific routes belong in
the owning module and are contributed through `KotaModule.routes`." The
recent migrations of `/commands`, `/history`, `/approvals`, `/owner-questions`,
`/push-tokens` have removed equivalent leakage on the daemon-control side; the
server-side analog still exists and is the next clear core-shrinking step. A
`scheduler` module already exists in `src/modules/scheduler/` and is the
natural owner.

## Desired Outcome

Both routes are contributed by the scheduler module via
`KotaModule.routes(ctx)`. `core/server-routes.ts` no longer mentions
`/api/schedules` or `/api/notifications`, and the corresponding `Scheduler`
and `NotificationHub` plumbing is removed from `ServerContext` if nothing
else needs them at request time. Existing client behavior (web UI, CLI
clients) is unchanged: same paths, same response shapes, same SSE contract.

## Constraints

- Follow the contribution pattern established by `src/modules/commands/`
  (provider registry where needed, `routes()` returning `RouteRegistration[]`).
- The scheduler is initialized as a singleton in core
  (`#core/daemon/scheduler.js`); the module's route handler should reach the
  live scheduler the same way the rest of the codebase already does (e.g.
  `getScheduler()`), not by accepting it as a constructor argument.
- The `NotificationHub` instance is per-server; the scheduler module needs an
  injection seam (provider registry or `ModuleContext`) to reach the live hub
  without recreating one. Keep the seam typed and minimal.
- `ServerContext.scheduler` and `ServerContext.hub` may still be needed for
  `/api/health` (`pendingSchedules` count) and `/api/daemon/status` — leave
  those untouched unless a clean co-migration is straightforward.
- Auth (Bearer token) and CORS behavior on the migrated routes must match
  current behavior exactly.
- Tests in `src/core/server/server.test.ts` that exercise these routes must
  continue to pass; if the migration moves their natural home, move the
  fixture coverage alongside.

## Done When

- `git grep "/api/schedules"` and `git grep "/api/notifications"` show the
  routes registered only inside `src/modules/scheduler/` and any test
  fixtures, not in `src/core/server/server-routes.ts`.
- `pnpm test` passes.
- `pnpm typecheck` (or the equivalent script in `package.json`) passes.
- A focused server.test (existing or new) hits both routes against a
  scheduler-module-loaded server and observes the expected JSON / SSE shape.

## Source / Intent

Module-first / core-shrinking initiative. Local `src/core/server/AGENTS.md`
already mandates the migration shape. Recent commit cadence (last ~10 commits)
shows this is the active migration front: each previous wave has migrated one
daemon-control or server route family at a time. The scheduler routes are the
last obvious capability-specific routes still living directly in
`core/server-routes.ts`.

## Initiative

Module-first / core-shrinking. Continue extracting capability-specific HTTP
surfaces into their owning modules so `src/core/` retains only protocol,
lifecycle, and shared runtime primitives.

## Acceptance Evidence

- Diff showing `core/server-routes.ts` no longer registers
  `/api/schedules` / `/api/notifications` and the scheduler module's
  `routes()` registration.
- `pnpm test` log showing scheduler-route coverage green.
- Manual `curl http://127.0.0.1:<port>/api/schedules` transcript (or the
  test fixture equivalent) showing the same JSON shape as before the
  migration.
