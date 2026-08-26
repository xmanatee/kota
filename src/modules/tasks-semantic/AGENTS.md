# Tasks-Semantic Module

Embedding-backed semantic search over the repo task queue.

- Wraps the default `RepoTasksProvider` keyword implementation with
  `SemanticTasksStore`.
- Keeps the sidecar index under `<scopeRoot>/.kota/tasks-semantic/`, not in
  git-tracked `data/tasks/`.
- Indexable text per task is title, summary, `## Problem`,
  `## Desired Outcome`, `## Constraints`, `## Source / Intent`, and
  `## Initiative`. `## Plan` and `## Acceptance Evidence` are excluded because
  they churn faster than intent.
- Registers itself as the `repo-tasks` provider selected by config.

## Boundaries

- Does not change canonical task files under `data/tasks/`.
- Adapter fingerprint is each task's `updated_at` timestamp.
- Reindex on demand via `kota task reindex`.
- CLI semantic search exits non-zero on embedding errors; pass `--keyword` for
  the default substring path.
- Without module config, keyword search remains available through the default
  provider.
