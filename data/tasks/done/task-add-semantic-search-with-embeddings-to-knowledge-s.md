---
id: task-add-semantic-search-with-embeddings-to-knowledge-s
title: Add semantic search with embeddings to knowledge store
status: done
priority: p2
area: stores
summary: The knowledge store uses file-based YAML entries with keyword search. As the store grows, keyword matching becomes insufficient for finding relevant entries. Add embedding-based semantic search so agents can find knowledge entries by meaning rather than exact terms.
created_at: 2026-04-15T02:51:59.040Z
updated_at: 2026-04-16T04:16:45.633Z
---

## Problem

The knowledge store (`KnowledgeProvider`) persists entries as markdown files with
YAML frontmatter under `.kota/data/`. Search is keyword-based: substring matching
on title, tags, content, and type fields. As the store accumulates entries across
runs and projects, keyword search returns too many irrelevant results for broad
queries and misses conceptually related entries that use different terminology.

The explorer workflow's `recall-knowledge` step and the knowledge CLI both depend
on search quality. Poor recall degrades agent context and leads to duplicate
discovery work.

## Desired Outcome

An embedding-backed semantic search layer for the knowledge store:

- Compute vector embeddings for each knowledge entry at write time.
- Store embeddings alongside the entry (in a SQLite database or sidecar file).
- Add a `semanticSearch(query, topK)` method to the `KnowledgeProvider` interface
  that returns entries ranked by cosine similarity.
- Fall back to keyword search when embeddings are unavailable (no API key, no
  embedding model configured).
- Re-embed existing entries lazily on first semantic query or via a CLI command
  (`kota knowledge reindex`).

## Constraints

- Use the configured model provider's embedding endpoint (Anthropic voyager or
  OpenAI `text-embedding-3-small`) rather than bundling a local model.
- Embedding computation should be async and non-blocking. Writes should not stall
  on embedding API calls — queue and compute in the background.
- Keep the file-based entry format unchanged. Embeddings are a sidecar index, not
  part of the canonical YAML entry.
- The feature should be opt-in via config. Keyword search remains the default
  when no embedding provider is configured.
- Implement as a module or provider variant, not as a core change.

## Done When

- `semanticSearch` returns entries ranked by meaning similarity.
- A query like "workflow cost tracking" finds entries tagged with "budget",
  "spend", and "cost anomaly" even without exact keyword matches.
- `kota knowledge reindex` rebuilds the embedding index from existing entries.
- Keyword search still works when embeddings are not configured.
- Tests cover: indexing, search ranking, fallback, and incremental re-embed on
  entry update.
