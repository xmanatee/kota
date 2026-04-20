# Stores

This directory implements the runtime state subsystem: the typed stores that
hold persistent and session-scoped agent data.

- Store types owned here are: history, working memory, and (separately)
  run artifacts. The `memory` store is owned by the `memory` module and the
  `knowledge` store is owned by the `knowledge` module — load those modules
  (or their semantic variants) before calling `getMemoryProvider` or
  `getKnowledgeProvider`. Memory and knowledge may have semantic index
  sidecars owned by their active providers (the `memory-semantic` and
  `knowledge-semantic` modules layered on top of the shared `semantic-index`
  engine); callers should use provider APIs instead of reading index files
  directly.
- Keep storage behavior explicit and durable. Don't add implicit persistence or
  auto-sync logic.
- Update this file when persistence ownership or access rules change. Exact
  file names and limits belong in the store/provider implementations and tests.
