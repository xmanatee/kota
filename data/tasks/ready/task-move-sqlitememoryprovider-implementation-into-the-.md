---
id: task-move-sqlitememoryprovider-implementation-into-the-
title: Move SQLiteMemoryProvider implementation into the sqlite-memory module
status: ready
priority: p2
area: architecture
summary: Relocate the SQLite-backed memory provider impl from src/core/memory/sqlite-memory.ts into the sqlite-memory module so the provider lives where the only consumer does, per the core-boundary rule
created_at: 2026-04-19T15:42:02.674Z
updated_at: 2026-04-19T15:42:02.674Z
---

## Problem

`src/core/memory/sqlite-memory.ts` hosts the full SQLite-backed
`MemoryProvider` implementation even though the only non-test consumer is
`src/modules/sqlite-memory/index.ts`, which just imports
`SQLiteMemoryProvider` and registers it. That split violates the
`src/core/` AGENTS.md boundary — "memory backends … should prefer
module-owned capability packs unless a shared runtime primitive truly has
to stay in core" — and is already called out as a confusing seam by
`src/modules/sqlite-memory/AGENTS.md`, which points readers back into core
to find the provider class.

The file is ~200 lines of SQLite-CLI adapter behavior (shelling out to the
`sqlite3` binary, JSON encoding, WAL mode, schema bootstrap). None of that
belongs in the kernel. Leaving it in core also makes the sqlite-memory
module look like an empty shim and obscures the real cost of enabling it
(requires the sqlite3 CLI, produces `.kota/memory.db`).

The recent `task-extract-semantic-index-engine-out-of-core-into-a-s`
establishes the migration pattern: a provider that only one module consumes
moves into that module, with the core import path retired.

## Desired Outcome

- The SQLite-backed memory provider class and its test live under
  `src/modules/sqlite-memory/`, not under `src/core/memory/`.
- `src/core/memory/sqlite-memory.ts` is deleted, along with its
  re-export from `src/core/memory/index.ts`.
- The sqlite-memory module registers its own provider class without
  importing from `#core/memory/sqlite-memory.js`.
- The module's local `AGENTS.md` no longer claims the provider lives in
  core; it accurately describes the provider as module-owned.
- The module-deps test (`src/module-deps.test.ts`) and all existing
  memory-provider tests still pass.

## Constraints

- Keep the existing `MemoryProvider` contract in
  `#core/modules/provider-types.ts`. Only the concrete implementation
  moves; the interface and the registry continue to live in core.
- Do not duplicate provider logic. Delete the core file when the module
  owns it — no compatibility re-export, no transitional alias.
- Preserve current health-check, reindex, and CLI-probe behavior exactly.
  This is a file-move refactor, not a functional rewrite.
- The sqlite-memory module already depends on the `memory` module via
  `dependencies: ["memory"]`; that relationship does not change.
- Do not expand scope to moving the default JSON memory store, history
  store, knowledge store, or task store. Those are still the kernel's
  default providers used by `provider-registry.ts` and are out of scope
  here.
- Respect the `src/core/` boundary rule: after the move, nothing in core
  should import from `#modules/sqlite-memory/…`.

## Done When

- `src/core/memory/sqlite-memory.ts` and
  `src/core/memory/sqlite-memory.test.ts` no longer exist.
- `src/modules/sqlite-memory/` contains the provider class, its test, and
  the module's `onLoad` wiring, all consistent with the module's declared
  behavior.
- `src/core/memory/index.ts` no longer re-exports `SQLiteMemoryProvider`.
- `pnpm test` and `pnpm typecheck` pass with the provider living in the
  module.
- `src/modules/sqlite-memory/AGENTS.md` reflects the new location and
  drops the "implementation lives in core" pointer.
