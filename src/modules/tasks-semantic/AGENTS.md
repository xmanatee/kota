# Tasks-Semantic Module

Embedding-backed semantic search over the repo task queue.

- Wraps the default `RepoTasksProvider` keyword implementation with a
  `SemanticTasksStore` that keeps a sidecar `.embeddings.json` index under
  `<projectDir>/.kota/tasks-semantic/`. The sidecar is a runtime cache, not
  source state, so it stays out of the git-tracked `data/tasks/` tree.
- Delegates embedding, cosine ranking, queueing, and reindex to the shared
  `SemanticIndexManager` in the `semantic-index` module. Only the
  task-specific adapter and indexable-text shape live in this module.
- Indexable text per task = `title` + `summary` + the `## Problem`,
  `## Desired Outcome`, `## Constraints`, `## Source / Intent`, and
  `## Initiative` body sections. `## Plan` and `## Acceptance Evidence`
  are excluded — they churn faster than intent and would spike re-embed
  traffic without improving recall.
- Uses the configured embedding provider (OpenAI or Voyage AI) via their
  OpenAI-compatible `/embeddings` endpoint.
- Registers itself as the `repo-tasks` provider selected by config.

## Boundaries

- Does not change the canonical task file layout under `data/tasks/`.
- Never embeds synchronously inside a task mutation; the sidecar is filled
  on demand or via `kota task reindex`. A semantic write that fails must
  not corrupt or block the underlying file write.
- Query-time embedding errors surface to the caller. The CLI `kota task
  search` exits non-zero with a single-line operator message rather than
  silently degrading to keyword search; pass `--keyword` to force the
  substring path through the default provider.
- Reindex on demand via `kota task reindex`; first semantic query lazily
  fills the index for any unknown or stale tasks.
- Staleness is detected via each task's `updated_at` timestamp; the CLI
  bumps it on every state transition.

Without module config the module is inactive; keyword search remains
available through the default `repo-tasks` provider.
