# Knowledge-Semantic Module

Embedding-backed semantic search over the file-based knowledge store.

- Wraps the default `KnowledgeStore` with a `SemanticKnowledgeStore` that
  keeps a sidecar `.embeddings.json` index next to entries.
- Delegates embedding, cosine ranking, queueing, and reindex to the shared
  `SemanticIndexManager` in the `semantic-index` module. Only the
  knowledge-specific adapter lives in this module.
- Uses the configured embedding provider (OpenAI or Voyage AI) via their
  OpenAI-compatible `/embeddings` endpoint.
- Registers itself as the knowledge provider selected by config.

## Boundaries

- Does not change the canonical markdown-plus-frontmatter entry format.
- Never embeds synchronously inside a write call; background queue only.
- Query-time embedding errors surface to the caller. Use keyword search
  explicitly when semantic ranking is not required.
- Reindex on demand via `kota knowledge reindex`; first semantic query
  lazily fills the index for any unknown or stale entries.
- Staleness is detected via each entry's `updated` timestamp.

Without module config the module is inactive; keyword search remains available
through the default provider.
