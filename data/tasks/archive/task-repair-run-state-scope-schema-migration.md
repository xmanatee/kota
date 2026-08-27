---
status: done
---

# Repair run-state scope schema migration

## Outcome

Commit `0dad16db9` introduced run-state schema version 4 and a daemon-owned migration from `projects`, `project_state_values`, and `project_id` columns to the canonical scope schema. It handles mixed version-3 state, renames dependent columns, and converts project resource keys.

## Completion Evidence

- A copy of the live database migrated to version 4 through the normal schema initializer.
- All 14 durable runs were preserved and legacy project tables and columns were absent afterward.
- The daemon started against the migrated database and resumed workflow dispatch.
- Implementation and focused migration coverage are owned by `src/core/workflow/run-state-schema.ts` and `src/core/workflow/run-state-database.test.ts`.

## Source / Intent

Completed by the workflow-runtime reliability repair on 2026-08-27. This record remains only as initiative history and must not be redispatched.
