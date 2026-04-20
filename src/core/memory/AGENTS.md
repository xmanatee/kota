# Stores

This directory implements the runtime state subsystem: the typed stores that
hold persistent and session-scoped agent data.

- Store types owned here are: history, memory, working memory, and (separately)
  run artifacts. The `knowledge` store is owned by the `knowledge` module, not
  by core — load that module (or the `knowledge-semantic` variant) before
  calling `getKnowledgeProvider`. Memory and knowledge may have semantic index
  sidecars owned by their active providers (the `memory-semantic` and
  `knowledge-semantic` modules layered on top of the shared `semantic-index`
  engine); callers should use provider APIs instead of reading index files
  directly.
- `compaction.ts` is co-located here because it operates on session context, but
  it is not a store — it belongs to the session loop.
- Keep storage behavior explicit and durable. Don't add implicit persistence or
  auto-sync logic.
- Update this file when persistence ownership or access rules change. Exact
  file names and limits belong in the store/provider implementations and tests.
