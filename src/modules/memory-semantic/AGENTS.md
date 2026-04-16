# Memory-Semantic Module

Embedding-backed semantic search over the file-based memory store.

- Wraps the default `MemoryStore` with a `SemanticMemoryStore` that keeps a
  sidecar `.embeddings.json` index next to `memory.json`.
- Uses the configured embedding provider (OpenAI or Voyage AI) via their
  OpenAI-compatible `/embeddings` endpoint.
- Registers itself as a `MemoryProvider` named `memory-semantic`. Activate by
  setting `providers.memory = "memory-semantic"`.

## Boundaries

- Does not change the canonical `memory.json` layout.
- Never embeds synchronously inside a write call; background queue only.
- Fails open — query-time errors fall back to base keyword search, never
  block the caller.
- Reindex on demand via `kota memory reindex`; first semantic query lazily
  fills the index for any missing or stale entries.
- Staleness is detected via a content+tags hash (memory has no `updated`
  timestamp); two writes that produce the same content leave the embedding
  untouched.

## Config

```jsonc
{
  "modules": {
    "memory-semantic": {
      "provider": "openai",           // "openai" | "voyage"
      "model": "text-embedding-3-small",
      "apiKey": "sk-...",             // optional; falls back to env
      "baseUrl": "..."                // optional override
    }
  },
  "providers": {
    "memory": "memory-semantic"
  }
}
```

Without module config the module is a no-op; keyword search stays active.
