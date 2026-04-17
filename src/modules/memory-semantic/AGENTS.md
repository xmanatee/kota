# Memory-Semantic Module

Embedding-backed semantic search over the file-based memory store.

- Wraps the default `MemoryStore` with a `SemanticMemoryStore` that keeps a
  sidecar `.embeddings.json` index next to `memory.json`.
- Uses the configured embedding provider (OpenAI or Voyage AI) via their
  OpenAI-compatible `/embeddings` endpoint.
- Registers itself as the memory provider selected by config.

## Boundaries

- Does not change the canonical `memory.json` layout.
- Never embeds synchronously inside a write call; background queue only.
- Query-time embedding errors surface to the caller. Use keyword search
  explicitly when semantic ranking is not required.
- Reindex on demand via `kota memory reindex`; first semantic query lazily
  fills the index for any missing or stale entries.
- Staleness is detected via a content+tags hash (memory has no `updated`
  timestamp); two writes that produce the same content leave the embedding
  untouched.

Without module config the module is inactive; keyword search remains available
through the default provider.
