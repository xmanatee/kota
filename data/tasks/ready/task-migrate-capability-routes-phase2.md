---
id: task-migrate-capability-routes-phase2
title: Migrate remaining capability routes from src/server/ to owning modules
status: ready
priority: p1
area: architecture
summary: The first phase of server route migration moved audit, config, and module-list routes to their owning modules. Five capability route files remain in src/server/ — memory, knowledge, history, approval-queue, and task — each owned by a module that exists in src/modules/.
created_at: 2026-04-10T08:00:00Z
updated_at: 2026-04-10T08:00:00Z
---

## Problem

After the first migration phase, `src/server/` still contains five capability-specific route files that belong in their owning modules:

- `memory-routes.ts` (113 lines) → `memory` module
- `knowledge-routes.ts` (142 lines) → `knowledge` module
- `history-routes.ts` (74 lines) → `history` module
- `approval-routes.ts` (129 lines) → `approval-queue` module
- `task-routes.ts` (360 lines) → `repo-tasks` module

Each owning module already exists in `src/modules/` with its own CLI, types, and logic. The route handlers staying in `src/server/` creates continued coupling and keeps the capability ownership boundary unclear.

## Desired Outcome

Each of these five modules contributes its HTTP route handlers via `KotaModule.routes`. The `server-routes.ts` orchestrator no longer imports from these five route files; they are deleted from `src/server/`. The server correctly wires module-contributed routes alongside the session/SSE core.

## Constraints

- Existing test files (`memory-routes.test.ts`, `knowledge-routes.test.ts`, etc.) must be co-located in the owning module and continue to pass.
- The external HTTP behavior (paths, methods, response shapes) must be identical after migration.
- Session routes, workflow routes, `server.ts`, `session-pool.ts`, `server-notifications.ts`, and `daemon-client.ts` are out of scope.
- Do not break the circular-import boundary: modules must not import from `src/server/`.
- Update `src/server/README.md` to reflect which files moved.

## Done When

- All five route files are contributed by their owning modules via `KotaModule.routes`.
- Deleted route files are removed from `src/server/`.
- `server-routes.ts` imports no longer reference the migrated files.
- `pnpm run typecheck`, `pnpm run lint`, `pnpm test`, and `pnpm build` all pass.
