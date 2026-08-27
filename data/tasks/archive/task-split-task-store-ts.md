---
status: done
---

# Split scheduler/task-store.ts — extract types into task-store-types.ts

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
