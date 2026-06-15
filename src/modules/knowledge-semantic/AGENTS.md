# Knowledge-Semantic Module

Embedding-backed semantic search over the file-based knowledge store.

- Wraps the default `KnowledgeStore` with `SemanticKnowledgeStore`.
- Keeps the sidecar index next to knowledge entries.
- Registers itself as the knowledge provider selected by config.

## Boundaries

- Does not change canonical markdown-plus-frontmatter entries.
- Adapter fingerprint is each entry's `updated` timestamp.
- Reindex on demand via `kota knowledge reindex`.
- Without module config, keyword search remains available through the default
  provider.
