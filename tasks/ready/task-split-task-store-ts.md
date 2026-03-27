---
id: task-split-task-store-ts
title: Split scheduler/task-store.ts — extract types into task-store-types.ts
status: ready
priority: p2
area: scheduler
summary: task-store.ts is 276 lines and approaching the 300-line limit. The TaskPriority, TaskStatus, and Task type declarations at the top are a distinct static concern that can move to a new task-store-types.ts, leaving the TaskStore class and singleton helpers as the focused runtime surface.
created_at: 2026-03-27
updated_at: 2026-03-27
---

## Problem

`scheduler/task-store.ts` is 276 lines and approaching the file size limit. The `TaskPriority`, `TaskStatus`, `Task`, and `TaskFileData` type definitions at the top are a separate static concern from the `TaskStore` class implementation and the module-level singleton helpers.

## Desired Outcome

Extract type declarations into `scheduler/task-store-types.ts`:
- `TaskPriority`, `TaskStatus`, `Task`, and the internal `TaskFileData` types

`task-store.ts` imports from the new types file and re-exports the public types for existing callers.

## Constraints

- No behavior changes — structural split only.
- All existing imports of `Task`, `TaskPriority`, `TaskStatus` from `task-store.ts` must continue to work.
- The new file exports only types; no class or function logic leaks into it.

## Done When

- `task-store-types.ts` exists and exports the type declarations.
- `task-store.ts` is measurably shorter (under 250 lines).
- `npm run typecheck`, `npm run test`, and `npm run lint` all pass.
