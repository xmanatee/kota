# Knowledge-Semantic Module

Embedding-backed semantic search over the file-based knowledge store.

- Wraps the default `KnowledgeStore` with a `SemanticKnowledgeStore` that
  keeps a sidecar `.embeddings.json` index next to entries.
- Delegates embedding, cosine ranking, queueing, and reindex to the shared
  `SemanticIndexManager` under `src/core/memory/semantic/`. Only the
  knowledge-specific adapter lives in this module.
- Uses the configured embedding provider (OpenAI or Voyage AI) via their
  OpenAI-compatible `/embeddings` endpoint.
- Registers itself as a `KnowledgeProvider` named `knowledge-semantic`.
  Activate by setting `providers.knowledge = "knowledge-semantic"`.

## Boundaries

- Does not change the canonical markdown-plus-frontmatter entry format.
- Never embeds synchronously inside a write call; background queue only.
- Fails open — query-time errors fall back to base keyword search, never
  block the caller.
- Reindex on demand via `kota knowledge reindex`; first semantic query
  lazily fills the index for any unknown or stale entries.
- Staleness is detected via each entry's `updated` timestamp.

## Config

```jsonc
{
  "modules": {
    "knowledge-semantic": {
      "provider": "openai",           // "openai" | "voyage"
      "model": "text-embedding-3-small",
      "apiKey": "sk-...",             // optional; falls back to env
      "baseUrl": "..."                // optional override
    }
  },
  "providers": {
    "knowledge": "knowledge-semantic"
  }
}
```

Without module config the module is a no-op; keyword search stays active.
