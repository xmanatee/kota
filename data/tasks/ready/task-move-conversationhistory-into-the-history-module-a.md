---
id: task-move-conversationhistory-into-the-history-module-a
title: Move ConversationHistory into the history module and retire src/core/memory
status: ready
priority: p2
area: architecture
summary: Relocate ConversationHistory and its utils from src/core/memory into the existing history module, completing the store-relocation pattern applied to MemoryStore, KnowledgeStore, and WorkingMemoryStore; after the move src/core/memory holds no store and can be retired
created_at: 2026-04-21T02:01:15.629Z
updated_at: 2026-04-21T02:01:15.629Z
---

## Problem

`src/core/memory/` still holds the `ConversationHistory` store (`history.ts`,
`history-utils.ts`, and their co-located tests) even though the `history`
module at `src/modules/history/` already owns the rest of the surface:
CLI commands, daemon routes, and conversation recall. The same ownership
shape has already been completed for the peer stores:

- MemoryStore → `memory` module (`f2b2495e`)
- KnowledgeStore → `knowledge` module (`9f7874e0`)
- WorkingMemoryStore → `working-memory` module (`707008f9`)
- Compaction helpers → `src/core/loop/` (`bb9a2f8e`)

`src/core/memory/AGENTS.md` now explicitly records that `history` is the
only store still owned by core — the other three are owned by their
modules. After the history move there is nothing left to own in
`src/core/memory/` and the directory can be retired entirely, matching
the earlier retirement of `src/core/data/` (`1782e3e8`).

The store is still imported through `#core/memory/history.js` and
`#core/memory/history-utils.js` from core surfaces (`core/loop/*`,
`core/daemon/*`, `core/modules/provider-*`, `core/server/daemon-client`)
and from the `history` module itself. That pinning keeps a core path in
place for a store the `history` module already effectively owns.

## Desired Outcome

`history.ts`, `history-utils.ts`, and their co-located tests live inside
`src/modules/history/` and the module exposes the store through a typed
public surface that callers outside the module import via
`#modules/history/...` instead of `#core/memory/...`. `src/core/memory/`
no longer exists. `ConversationHistory`, `ConversationRecord`,
`ConversationData`, and `getHistory` are reachable by all current
callers (core loop, daemon, provider registry, daemon client types, the
`history` module's own CLI / routes / recall) through the new
module-owned paths.

No behavior change: conversation persistence layout on disk, existing
`~/.kota/history/` format, `getHistory()` singleton semantics, and all
CLI/route behavior remain identical. The only visible change is the
import path.

## Constraints

- Match the pattern from the MemoryStore, KnowledgeStore, and
  WorkingMemoryStore moves: the store files move into the module, the
  module's `index.ts` imports them via local relative paths, and a single
  public `#modules/history/...` surface is published for the types and
  `getHistory` accessor that external callers need.
- Do not duplicate the store in both places. Delete the core copies in
  the same change; no compatibility shim, no `#core/memory/*` re-export.
- Update every import of `#core/memory/history.js` and
  `#core/memory/history-utils.js` across the repo (core loop, daemon,
  provider registry, daemon client types, tests, and the `history`
  module itself) to the new module-owned path.
- Remove `src/core/memory/` entirely when the last file is relocated;
  do not leave an empty `AGENTS.md` behind. Update
  `src/core/AGENTS.md` if needed to reflect that no `memory/` subtree
  remains in core.
- Keep test coverage equivalent — the co-located test files move with
  their store files; do not lose cases.
- Do not change on-disk conversation format, file layout under
  `~/.kota/history/`, or any exported function signature.
- No new parallel registry, re-export barrel in `src/`, or compatibility
  alias.

## Done When

- `src/core/memory/history.ts`, `src/core/memory/history.test.ts`,
  `src/core/memory/history-utils.ts`, and
  `src/core/memory/history-utils.test.ts` no longer exist.
- The store files live inside `src/modules/history/` with their tests,
  and the module re-exports the public surface (`getHistory`,
  `ConversationHistory`, `ConversationRecord`, `ConversationData`) on
  a typed `#modules/history/...` path.
- `src/core/memory/` is removed entirely (including its `AGENTS.md`).
- `rg "#core/memory/"` returns no hits outside historical run artifacts.
- `pnpm typecheck`, `pnpm test`, and `pnpm lint` pass on the final
  tree.
- The `history` module's own `AGENTS.md` is updated to note that it
  owns the store (mirroring the `memory`, `knowledge`, and
  `working-memory` module docs), and `src/core/memory/AGENTS.md` is
  gone alongside the directory.
