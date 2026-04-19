# Semantic Index Module

Shared embedding-index engine used by the provider modules that bolt semantic
search onto KOTA's file-based stores (`memory-semantic`, `knowledge-semantic`).

- `cosine.ts` — cosine similarity for dense vectors.
- `embedding-provider.ts` — OpenAI-compatible HTTP embedding client plus
  shared module-config parsing.
- `semantic-index.ts` — sidecar `.embeddings.json` file format (version,
  model, `fingerprint` + `embedding` per entry).
- `semantic-index-manager.ts` — generic engine: background embed queue,
  staleness detection via `fingerprint`, cosine ranking, bulk reindex,
  explicit query-time error propagation.

Consumer modules supply a `SemanticStoreAdapter` and implement the owning
store's public provider interface around the manager. The module itself does
not register a provider; it only ships the shared engine as a capability pack.

The `fingerprint` is an opaque string set by the adapter. Knowledge uses the
entry's `updated` ISO timestamp; memory uses a content-plus-tags hash. The
manager only compares equality.
