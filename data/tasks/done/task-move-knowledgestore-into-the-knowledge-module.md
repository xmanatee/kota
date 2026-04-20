---
id: task-move-knowledgestore-into-the-knowledge-module
title: Move KnowledgeStore into the knowledge module
status: done
priority: p2
area: architecture
summary: Extract the file-based KnowledgeStore implementation from src/core/memory into the existing knowledge module, continuing the core-shrink/provider-module pattern already used for sqlite-memory and semantic-index
created_at: 2026-04-20T15:59:24.805Z
updated_at: 2026-04-20T17:20:28.695Z
---

## Problem

`src/core/memory/knowledge-store.ts` still carries the concrete file-based
KnowledgeStore implementation (markdown+YAML entries under `.kota/data/` and
`~/.kota/data/`), plus its singleton factory `getKnowledgeStore` and reset
helper. Core already treats knowledge as a provider-shaped service — the
`KnowledgeProvider` interface lives in `src/core/modules/provider-types.ts`
and `ProviderRegistry` registers the file-based store as the `default`
provider — but the default implementation itself is still in the kernel and
is hard-imported from `provider-registry.ts` and `core/memory/index.ts`. The
`knowledge` module today only contributes the `knowledge` tool, the CLI, and
HTTP routes; the actual storage it manages lives outside its tree. This is
the same shape the `sqlite-memory` and `semantic-index` extractions already
corrected for other stores.

## Desired Outcome

- The file-based KnowledgeStore implementation (class, helpers, singleton
  factory, reset helper, and store-local tests) moves into the `knowledge`
  module's directory.
- The `knowledge` module registers the file-based store as the `default`
  knowledge provider at load time, through the provider registry.
- `src/core/` no longer hard-imports the concrete KnowledgeStore
  implementation. Core keeps the `KnowledgeProvider` contract and the
  registry; the file-based fallback in `getKnowledgeProvider` either goes
  away or becomes a protocol-only no-op — callers resolve through the
  provider registry once the `knowledge` module has loaded.
- Call sites across core, init, and other modules import from the new
  location (or, preferably, through the provider registry).
- `src/core/memory/AGENTS.md` and related docs reflect the new ownership,
  with no references to a file-based knowledge store living in core.

## Constraints

- No alias re-exports, deprecation shims, or parallel import paths from
  `#core/memory/knowledge-store.js`. Call sites move cleanly.
- Keep the public KnowledgeStore/KnowledgeEntry/SearchFilters types stable
  so the `knowledge` tool, CLI, routes, and `knowledge-semantic` provider
  keep working.
- Do not change the on-disk format or entry ids; this is a relocation, not a
  migration.
- Preserve existing test coverage by moving the corresponding tests with the
  implementation, not by rewriting them.
- Keep module dependencies honest: if any other module consumes the
  knowledge store, declare `knowledge` in its `dependencies` per
  `src/modules/AGENTS.md`.
- Follow module-factory/provider-registry patterns already used by
  `sqlite-memory` and `semantic-index` instead of inventing a new
  registration surface.

## Done When

- `src/core/memory/knowledge-store.ts` and its tests no longer exist in
  core; the implementation lives in `src/modules/knowledge/`.
- The provider registry default-registration of `knowledge` is driven by
  the `knowledge` module's load-time contribution, not by a core hard
  import.
- `pnpm typecheck`, `pnpm test`, and `pnpm lint` pass across the repo with
  no references to the old core path.
- The knowledge module's `AGENTS.md` states that it owns the file-based
  KnowledgeStore implementation; the core memory `AGENTS.md` no longer
  claims it.
