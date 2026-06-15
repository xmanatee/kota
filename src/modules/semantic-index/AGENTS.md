# Semantic Index Module

Shared embedding-index engine used by provider modules that add semantic
search to KOTA's file-based stores.

## Contract

- Embedding providers are OpenAI and Voyage through an OpenAI-compatible
  `/embeddings` API.
- The sidecar cache stores version, model, adapter fingerprint, and dense
  embedding per indexed item.
- `SemanticIndexManager` owns background embedding, cosine ranking, bulk
  reindex, staleness checks, lazy fill, and query-time error propagation.
- Store adapters own indexable text, sidecar location, and fingerprint shape.
- Semantic providers never mutate the canonical store and never embed
  synchronously in the write path.

Consumer modules provide a `SemanticStoreAdapter` and implement their owning
store's public provider interface around the manager. This module registers no
provider; it is only the shared capability pack.
