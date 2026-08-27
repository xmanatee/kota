---
status: done
---

# Split scheduler/task-router.ts — extract pattern data into task-router-data.ts

## Problem

`scheduler/task-router.ts` is 276 lines and approaching the file size limit. The file mixes static data tables (`TASK_PATTERNS`, `STRATEGIES`, `GROUP_RECOMMENDATIONS`) with the types and logic (`routeTask`, `formatTaskHint`). The data tables alone are ~200 lines and are a distinct static concern from the routing algorithm.

## Desired Outcome

Extract static data tables into `scheduler/task-router-data.ts`:
- `TASK_PATTERNS`, `STRATEGIES`, `GROUP_RECOMMENDATIONS`
- Internal types used only by the data (`PatternEntry`)

`task-router.ts` imports from the new data file and retains the exported types (`TaskType`, `TaskRoute`) and logic functions (`routeTask`, `formatTaskHint`).

## Constraints

- No behavior changes — structural split only.
- All existing imports from `task-router.ts` must continue to work unchanged.
- The new file exports only data and the `PatternEntry` type; no routing logic leaks into it.

## Done When

- `task-router-data.ts` exists and exports the data tables.
- `task-router.ts` is measurably shorter (under 100 lines).
- `npm run typecheck`, `npm run test`, and `npm run lint` all pass.
