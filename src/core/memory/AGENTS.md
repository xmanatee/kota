# Stores

This directory implements the core runtime state surface for history.

- The `history` store is the only store owned here. Other store types are owned
  by their modules: `memory` by the `memory` module, `knowledge` by the
  `knowledge` module, and `working-memory` by the `working-memory` module.
  Load those modules (or their semantic variants) before calling
  `getMemoryProvider` or `getKnowledgeProvider`. Memory and knowledge may have
  semantic index sidecars owned by their active providers (the
  `memory-semantic` and `knowledge-semantic` modules layered on top of the
  shared `semantic-index` engine); callers should use provider APIs instead of
  reading index files directly. Run artifacts are a separate typed store
  written through the workflow runtime.
- Keep storage behavior explicit and durable. Don't add implicit persistence or
  auto-sync logic.
- Update this file when persistence ownership or access rules change. Exact
  file names and limits belong in the store/provider implementations and tests.
