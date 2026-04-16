---
id: task-add-embedding-backed-semantic-search-to-memory-sto
title: Add embedding-backed semantic search to memory store
status: done
priority: p2
area: stores
summary: The knowledge store gained semantic search via a sidecar embedding index in knowledge-semantic. Memory recall still uses keyword matching and degrades on cross-term queries. Add a parallel memory-semantic module or shared index abstraction.
created_at: 2026-04-16T07:47:20.502Z
updated_at: 2026-04-16T13:51:55.235Z
---

## Problem

The `knowledge-semantic` module added a sidecar embedding index and a
`SemanticKnowledgeStore` that ranks entries by cosine similarity, activated
via `providers.knowledge = "knowledge-semantic"`. Memory entries — persistent
agent notes surfaced by the `memory` tool and `kota memory …` CLI — still
rely on keyword substring matching over title, tags, and content. As the
memory store grows across runs, agents miss semantically related entries that
use different terminology, leading to duplicate notes and weaker context
recall.

Memory and knowledge have structurally identical recall needs (short-form
entry, tag set, content body) but benefit from different embedding scopes and
write volumes. The work done for knowledge-semantic should generalize rather
than be copy-pasted.

## Desired Outcome

Memory recall supports embedding-backed semantic search while keeping the
file-based storage format unchanged:

- A `memory-semantic` module (or a shared `semantic-store` primitive reused
  by both knowledge and memory) provides `semanticSearch(query, topK)` on
  top of the existing `MemoryProvider` interface.
- Embeddings are computed in the background — never synchronously during a
  memory write.
- Activation is opt-in via config, the same shape used for knowledge-semantic
  (`providers.memory = "memory-semantic"` with a module config block).
- `kota memory reindex` rebuilds the embedding index from existing entries.
- Keyword search remains the default when no embedding provider is
  configured; semantic search fails open to keyword search on provider errors.

## Constraints

- Do not duplicate the embedding queue, cosine helper, provider adapter, or
  reindex logic from `knowledge-semantic`. Extract the reusable portions into
  a shared helper used by both modules.
- Keep the memory entry format unchanged; embeddings remain a sidecar index.
- Do not embed memory content at core write sites — embedding is a module
  concern triggered by subscribing to memory write events.
- Do not bundle a local embedding model; reuse the configured embedding
  provider (OpenAI / Voyage) via the same config shape as knowledge-semantic.

## Done When

- `semanticSearch` returns memory entries ranked by meaning similarity.
- A query semantically adjacent to (but lexically distinct from) stored
  memory entries returns the related entries without keyword overlap.
- `kota memory reindex` rebuilds the index from existing entries.
- Keyword search still works when no embedding provider is configured.
- Shared embedding/cosine/reindex logic is used by both semantic modules —
  no duplicated copies.
- Tests cover indexing, ranked search, fallback path, and incremental
  re-embed on entry update.
