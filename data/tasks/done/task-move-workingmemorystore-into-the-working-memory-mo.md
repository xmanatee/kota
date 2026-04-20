---
id: task-move-workingmemorystore-into-the-working-memory-mo
title: Move WorkingMemoryStore into the working-memory module
status: done
priority: p2
area: architecture
summary: Relocate the session-scoped WorkingMemoryStore from src/core/memory to the existing working-memory module, continuing the core-shrink pattern already applied to MemoryStore and KnowledgeStore so src/core/memory holds only the history store
created_at: 2026-04-20T22:40:28.166Z
updated_at: 2026-04-20T23:30:13.191Z
---

## Problem

`src/core/memory/working-memory.ts` still lives in core even though the only
consumer is the `working-memory` module: the module imports `setEntry`,
`getEntry`, `listEntries`, `removeEntry`, `clearAll`, `getPersistentEntries`,
`loadEntries`, and `getWorkingMemoryState` from `#core/memory/working-memory.js`
and registers `getWorkingMemoryState` itself as a dynamic state provider.
Nothing in `src/core/loop/`, the session runtime, or any other module reads the
store directly.

`src/core/memory/AGENTS.md` already records that the `memory` store is owned by
the `memory` module and the `knowledge` store is owned by the `knowledge`
module — moves landed in commits `f2b2495e` (MemoryStore) and `9f7874e0`
(KnowledgeStore). The working-memory store has the same shape of ownership
(single module imports a core file, registers it through the normal module
context) but has not yet been relocated, so `src/core/memory/` still holds the
store plus its co-located test alongside the genuinely core-owned history
store. Keeping the store in core pins the `working-memory` module to a
`#core/memory/*` path it does not otherwise need.

## Desired Outcome

`src/core/memory/working-memory.ts` and its co-located test move into
`src/modules/working-memory/` and the module imports the store through a local
relative path instead of `#core/memory/working-memory.js`. The WorkingMemoryEntry
type and all store functions become module-internal. Core no longer ships the
working-memory store, and `src/core/memory/` is left holding only the history
store (plus its `AGENTS.md`, updated to reflect the new shape).

The manifest validation default module list keeps `working-memory` as before —
no behavior change for operators — and all dynamic-state, persistence, and
compaction behavior continues to work unchanged because the module already owns
the lifecycle hooks that drive it.

## Constraints

- Match the pattern from the MemoryStore/KnowledgeStore moves: the store file
  moves into the module, imports become local-relative, and no new public
  `#modules/*` surface is created just for the store.
- Do not duplicate the store in both places. Delete the core copy in the same
  change; no compatibility shim or re-export.
- Update `src/core/memory/AGENTS.md` so it accurately describes what remains
  (history store only) and drop the line that still implies working-memory
  lives in core.
- Keep test coverage equivalent — the co-located test file moves with the
  store file; do not lose cases.
- No change to the working-memory tool's observable behavior, persisted
  storage key, system-prompt tag format, or compaction thresholds.
- Do not touch the unrelated `history` store or its test file in this task.

## Done When

- `src/core/memory/working-memory.ts` and `src/core/memory/working-memory.test.ts`
  are removed from `src/core/memory/`.
- The store and its test live inside `src/modules/working-memory/`, and the
  module's `index.ts` imports it via a local relative path.
- `src/core/memory/AGENTS.md` no longer describes the working-memory store as
  core-owned and accurately reflects the remaining content.
- `pnpm typecheck`, `pnpm test`, and `pnpm lint` pass on the final tree.
- `rg "#core/memory/working-memory"` returns no hits outside historical run
  artifacts.
