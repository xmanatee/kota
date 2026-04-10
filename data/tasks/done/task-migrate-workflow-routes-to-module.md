---
id: task-migrate-workflow-routes-to-module
title: Migrate workflow HTTP routes from src/server/ to the workflow module
status: done
priority: p2
area: architecture
summary: workflow-routes.ts (375 lines) and workflow-run-routes.ts (348 lines) are the last large capability-specific route files remaining in src/server/. They belong in the workflow module, which already owns the scheduler, workflow definitions, trigger logic, and run store.
created_at: 2026-04-10T08:00:00Z
updated_at: 2026-04-10T08:00:00Z
---

## Problem

After phase 1 and phase 2 of the server route migration, `workflow-routes.ts` and `workflow-run-routes.ts` remain as the only large capability files in `src/server/`. These ~720 lines of route handlers are tightly coupled to the workflow runtime, yet they live outside the `workflow` module that owns everything else workflow-related.

The prior migration task explicitly scoped these out to keep blast radius manageable. Completing this move finishes the route migration and leaves `src/server/` with only truly server-core files (session pool, session routes, daemon client, server notifications, server orchestrator).

## Desired Outcome

The `workflow` module contributes workflow and workflow-run route handlers via `KotaModule.routes`. The `server-routes.ts` orchestrator wires these alongside other module-contributed routes without importing from `src/server/workflow-routes.ts` or `src/server/workflow-run-routes.ts`. Those files are deleted.

## Constraints

- `workflow-routes.test.ts` and `workflow-run-routes.ts` tests must move with the handlers and continue to pass.
- External HTTP behavior (paths, methods, response shapes) must be identical.
- The `workflow` module already imports from the scheduler and run store; do not add upward imports to `src/server/`.
- `src/server/README.md` must be updated.

## Done When

- `workflow-routes.ts` and `workflow-run-routes.ts` no longer exist in `src/server/`.
- The `workflow` module contributes these routes via `KotaModule.routes`.
- `src/server/` contains only the server-core files (session pool, session routes, daemon client, server notifications, server orchestrator).
- `pnpm run typecheck`, `pnpm run lint`, `pnpm test`, and `pnpm build` all pass.
