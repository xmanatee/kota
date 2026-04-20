---
id: task-move-memorystore-into-the-memory-module
title: Move MemoryStore into the memory module
status: done
priority: p2
area: architecture
summary: Extract the file-based MemoryStore implementation from src/core/memory into the existing memory module, continuing the core-shrink/provider-module pattern already applied to knowledge and sqlite-memory
created_at: 2026-04-20T17:32:05.580Z
updated_at: 2026-04-20T18:21:53.564Z
---

## Problem

`src/core/memory/store.ts` still carries the concrete file-based
MemoryStore implementation (JSON-backed notes under `.kota/` with an
in-process loader, reindex hook, and singleton `getMemoryStore` factory).
Core already treats memory as a provider-shaped service — the
`MemoryProvider` interface lives in `src/core/modules/provider-types.ts`
and `ProviderRegistry` registers the file-based store as the `default`
`memory` provider — but the default implementation itself is still in the
kernel and is hard-imported from `provider-registry.ts` as
`#core/memory/store.js`. The `memory` module today owns the `memory` tool,
skill, CLI, and routes; its own `AGENTS.md` explicitly states the storage
implementation lives in core. The `sqlite-memory` module already ships an
alternative provider; the base file-backed store is the last hold-out and
is the direct parallel of the KnowledgeStore relocation that just landed
(9f7874e0).

## Desired Outcome

- The file-based MemoryStore implementation (class, Memory and
  ReindexResult types, singleton factory, reset helper, and store-local
  tests) moves into the `memory` module's directory.
- The `memory` module registers the file-based store as the `default`
  memory provider at load time, through the provider registry, the same
  way `sqlite-memory` registers its alternative.
- `src/core/` no longer hard-imports the concrete MemoryStore
  implementation. Core keeps the `MemoryProvider` contract and the
  registry; the file-based fallback in `getMemoryProvider` either goes
  away or becomes a protocol-only no-op — callers resolve through the
  provider registry once the `memory` module has loaded.
- Call sites across core, init, memory-semantic, and other modules import
  from the new location (or, preferably, through the provider registry).
- `src/core/memory/AGENTS.md` and the memory module's `AGENTS.md` reflect
  the new ownership, with no references to a file-based memory store
  living in core.

## Constraints

- No alias re-exports, deprecation shims, or parallel import paths from
  `#core/memory/store.js`. Call sites move cleanly.
- Keep the public MemoryStore/Memory/ReindexResult types stable so the
  `memory` tool, CLI, routes, `memory-semantic` provider, and init
  pipeline keep working.
- Do not change the on-disk format or entry ids; this is a relocation,
  not a migration.
- Preserve existing test coverage by moving the corresponding tests with
  the implementation, not by rewriting them.
- Keep module dependencies honest: if any other module consumes the
  memory store through module imports, declare `memory` in its
  `dependencies` per `src/modules/AGENTS.md`.
- Follow the module-factory/provider-registry pattern already used by
  `sqlite-memory`, `semantic-index`, and the recently relocated
  `knowledge` module instead of inventing a new registration surface.
- Do not conflate memory with working-memory or history relocations.
  Those stores still live in `src/core/memory/` and are out of scope.

## Done When

- `src/core/memory/store.ts` and its tests no longer exist in core; the
  implementation lives in `src/modules/memory/`.
- The provider registry default-registration of `memory` is driven by
  the `memory` module's load-time contribution, not by a core hard
  import.
- `pnpm typecheck`, `pnpm test`, and `pnpm lint` pass across the repo
  with no references to the old core path.
- The memory module's `AGENTS.md` states that it owns the file-based
  MemoryStore implementation; the core memory `AGENTS.md` no longer
  claims it.
