---
id: task-extract-gather-context-shared-utils
title: Extract shared utilities from gather-context files
status: done
priority: p2
area: workflow
summary: RunSummary, summarizeRun, loadRecentCommits, and runtimeState aggregation are copy-pasted across all three workflow gather-context files. Extract them into src/workflows/shared.ts to eliminate ~60 lines of duplication.
created_at: 2026-03-20
updated_at: 2026-03-20T05:50:00Z
---

## Problem

`src/workflows/explorer/gather-context.ts`, `builder/gather-context.ts`, and `improver/gather-context.ts` each define identical `RunSummary` type, `summarizeRun` function, `loadRecentCommits` function, and the `runtimeState` aggregation block. Any change to these (e.g. adding a new field to `RunSummary`) must be applied in three places.

`src/workflows/shared.ts` already exists and holds other shared workflow utilities, making it the natural home for these.

## Desired Outcome

- `RunSummary`, `summarizeRun`, `loadRecentCommits`, and the `runtimeState` aggregation helper are defined once in `src/workflows/shared.ts`.
- Each gather-context file imports from `shared.ts` instead of defining its own copy.
- No behavior changes; existing tests continue to pass.

## Constraints

- Do not merge the `*Context` types or `gather*Context` functions themselves — only the shared sub-utilities.
- Tests for each gather-context file must remain green.
- Keep the refactor minimal: do not reorganize gather-context logic beyond what is needed to remove the duplication.

## Done When

- `RunSummary`, `summarizeRun`, `loadRecentCommits` exist only in `src/workflows/shared.ts`.
- All three gather-context files import and use these shared utilities.
- `npm run typecheck`, `npm run lint`, and `npm test` pass.
