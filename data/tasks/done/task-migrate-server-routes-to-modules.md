---
id: task-migrate-server-routes-to-modules
title: Migrate src/server/ route handlers to owning modules
status: done
priority: p1
area: architecture
summary: src/server/ is a 6K-line shared bucket of route handlers that belong in their owning modules (memory, knowledge, approval, history, task). Move route registrations to the modules that own those capabilities.
created_at: 2026-04-10T06:50:00Z
updated_at: 2026-04-10T06:50:00Z
---

## Problem

`src/server/` contains route handlers for memory, knowledge, approvals, history, tasks, audit, config, and modules — each owned by a module elsewhere in `src/modules/`. This is the classic "shared bucket" anti-pattern the architecture explicitly calls out as a migration target. The routes for memory belong in the memory module, knowledge routes in the knowledge module, and so on. As long as these routes live in `src/server/`, they accumulate coupling and the capability ownership boundary stays unclear.

The server itself (`server.ts`, `session-pool.ts`, `server-routes.ts`) and the session route handlers are legitimate server-core concerns. The capability-specific route files are not.

## Desired Outcome

Each module that owns a capability also owns its HTTP route handlers, contributing them via `KotaModule.routes` (the `RouteRegistration[]` field). The central `server-routes.ts` becomes a thin orchestrator that wires module-contributed routes into the server alongside the session/SSE core.

Priority order for migration (most self-contained first):
1. `audit-routes.ts` → `guardrails-audit` module
2. `config-routes.ts` → `config` module
3. `module-routes.ts` → `module-manager` module
4. `memory-routes.ts` → `memory` module
5. `knowledge-routes.ts` → `knowledge` module
6. `history-routes.ts` → `history` module
7. `approval-routes.ts` → `approval-queue` module
8. `task-routes.ts` → `repo-tasks` module

It is acceptable to migrate a subset in this run and capture remaining items in a follow-up. At minimum, items 1–3 should move.

## Constraints

- `session-pool.ts`, `session-routes.ts`, `server-notifications.ts`, `server.ts`, and `daemon-client.ts` stay in `src/server/` — they are server-core.
- `workflow-routes.ts` and `workflow-run-routes.ts` stay in `src/server/` or move to the `workflow` module — treat as out of scope for this task to keep blast radius manageable.
- Do not break the circular-import boundary: `src/server/` already imports from `src/scheduler/`; modules must not import back from `src/server/`.
- Existing route tests must be migrated alongside the handlers and continue to pass.
- The external HTTP behavior (paths, methods, response shapes) must be identical after migration.

## Done When

- At least the three self-contained route groups (audit, config, module-list) are contributed by their owning modules via `KotaModule.routes`.
- No duplicate or orphaned route registrations exist.
- `pnpm run typecheck`, `pnpm run lint`, `pnpm test`, and `pnpm build` all pass.
