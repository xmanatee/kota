---
id: task-repair-run-state-scope-schema-migration
title: Repair run-state scope schema migration
status: done
priority: p0
area: workflow-runtime
summary: Migrated legacy project-shaped run-state databases to the canonical scope schema without losing durable workflow history.
task_class: Platform
created_at: 2026-08-26T23:54:21.238Z
updated_at: 2026-08-27T00:45:00.000Z
---
## Outcome

Commit `0dad16db9` introduced run-state schema version 4 and a daemon-owned migration from `projects`, `project_state_values`, and `project_id` columns to the canonical scope schema. It handles mixed version-3 state, renames dependent columns, and converts project resource keys.

## Completion Evidence

- A copy of the live database migrated to version 4 through the normal schema initializer.
- All 14 durable runs were preserved and legacy project tables and columns were absent afterward.
- The daemon started against the migrated database and resumed workflow dispatch.
- Implementation and focused migration coverage are owned by `src/core/workflow/run-state-schema.ts` and `src/core/workflow/run-state-database.test.ts`.

## Source / Intent

Completed by the workflow-runtime reliability repair on 2026-08-27. This record remains only as initiative history and must not be redispatched.
