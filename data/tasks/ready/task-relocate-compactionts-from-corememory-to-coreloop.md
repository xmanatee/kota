---
id: task-relocate-compactionts-from-corememory-to-coreloop
title: Relocate compaction.ts from core/memory to core/loop
status: ready
priority: p2
area: architecture
summary: compaction.ts operates on session context and is explicitly flagged in core/memory/AGENTS.md as belonging to the session loop, not stores; move it alongside loop/context.ts where it is already consumed
created_at: 2026-04-20T18:26:14.766Z
updated_at: 2026-04-20T18:33:00.000Z
---

## Problem

`src/core/memory/compaction.ts` (plus its co-located `compaction.test.ts`) lives
in the runtime-state stores directory even though it is not a store.
`src/core/memory/AGENTS.md` already acknowledges this mismatch:

> `compaction.ts` is co-located here because it operates on session context,
> but it is not a store — it belongs to the session loop.

The recent relocations of `MemoryStore` into the `memory` module and
`KnowledgeStore` into the `knowledge` module have thinned `src/core/memory/`
down to history, working memory, and this stray compaction helper. Leaving
compaction in place keeps the store directory semantically mixed and forces a
future reader to understand why a session-loop primitive sits under
`core/memory/`. Its only active consumers are already under `src/core/loop/`
(`context.ts`) plus one integration test (`src/context-pipeline.test.ts`);
nothing else in core or modules depends on the current import path.

## Desired Outcome

- `compaction.ts` and `compaction.test.ts` live under `src/core/loop/` beside
  the other session-context primitives that call them.
- `src/core/memory/index.ts` no longer re-exports compaction helpers; callers
  import from the new loop path instead.
- `src/core/memory/AGENTS.md` is shortened to describe what actually lives in
  stores after the move, without the residual "co-located here because" note.
- The broader "runtime state subsystem" description stays accurate: history,
  working memory, and run artifacts are the only store types owned under
  `src/core/memory/`.

## Constraints

- Do not change compaction behavior, signatures, or tests; this is a pure
  relocation.
- Update every call site in `src/` in the same commit. No barrel re-exports
  from the old path, no compatibility shims, no dual import paths.
- Keep the move contained: do not also relocate `history.ts`,
  `working-memory.ts`, or `history-utils.ts` — they are genuine stores and
  should stay under `src/core/memory/`.
- If `src/core/memory/index.ts` becomes empty or trivial after the move,
  delete it rather than leaving a stub; update callers that used the barrel to
  import directly.
- Keep the session-loop `AGENTS.md` at `src/core/loop/` accurate if it gains a
  new primitive, but prefer not to inflate it — directory-level AGENTS.md files
  stay concise per repo policy.
- Do not introduce a new `core/loop/compaction/` subdirectory; the file stays
  flat alongside the other `loop/*.ts` primitives.

## Done When

- `src/core/memory/compaction.ts` and `src/core/memory/compaction.test.ts` no
  longer exist; the equivalent files live under `src/core/loop/`.
- `grep -r "core/memory/compaction"` returns no matches in `src/`.
- `src/core/memory/AGENTS.md` no longer mentions compaction.
- `pnpm typecheck` and the compaction test both pass.
