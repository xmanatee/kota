# Memory-Semantic Module

Embedding-backed semantic search over the file-based memory store.

- Wraps the default `MemoryStore` with `SemanticMemoryStore`.
- Keeps the sidecar index next to `memory.json`.
- Registers itself as the memory provider selected by config.

## Boundaries

- Does not change canonical `memory.json`.
- Adapter fingerprint is a content-plus-tags hash because memory entries have
  no `updated` timestamp.
- Reindex on demand via `kota memory reindex`.
- Without module config, keyword search remains available through the default
  provider.
