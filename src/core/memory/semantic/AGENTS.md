# Semantic Index Engine

Shared primitives for embedding-backed search over KOTA's file-based stores
(knowledge, memory). Each concrete store ships its own module that plugs a
thin adapter into the generic `SemanticIndexManager`.

- `cosine.ts` — cosine similarity for dense vectors.
- `embedding-provider.ts` — OpenAI-compatible HTTP embedding client plus
  shared module-config parsing.
- `semantic-index.ts` — sidecar `.embeddings.json` file format (version,
  model, `fingerprint` + `embedding` per entry).
- `semantic-index-manager.ts` — generic engine: background embed queue,
  staleness detection via `fingerprint`, cosine ranking, bulk reindex,
  fail-open query fallback.

Concrete wrappers (in `src/modules/<name>-semantic/`) supply a
`SemanticStoreAdapter` and implement the store's public provider interface
around the manager.

The `fingerprint` is an opaque string set by the adapter. Knowledge uses the
entry's `updated` ISO timestamp; memory uses a content-plus-tags hash. The
manager only compares equality.
