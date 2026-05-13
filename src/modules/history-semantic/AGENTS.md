# History-Semantic Module

Embedding-backed semantic search over the file-based conversation history store.

- Wraps the project-scoped `ConversationHistory` with a `SemanticHistoryStore` that
  keeps a sidecar `.embeddings.json` index next to `index.json` in the history
  directory.
- Delegates embedding, cosine ranking, queueing, and reindex to the shared
  `SemanticIndexManager` in the `semantic-index` module. Only the
  history-specific adapter lives in this module.
- Uses the configured embedding provider (OpenAI or Voyage AI) via their
  OpenAI-compatible `/embeddings` endpoint.
- Registers itself as the history provider selected by config.

## Boundaries

- Does not change the canonical `index.json` or per-conversation `<id>.json` layout.
- Never embeds synchronously inside a save call; background queue only.
- Query-time embedding errors surface to the caller. Use keyword search
  explicitly when semantic ranking is not required.
- Reindex on demand via `kota history reindex`; first semantic query lazily
  fills the index for any unknown or stale conversations.
- Staleness is detected via each conversation's `updatedAt` timestamp; the
  base store bumps it on every save.

Without module config the module is inactive; keyword search remains available
through the default provider.
