# GitHub Module

This directory owns the GitHub REST API capability pack — typed tools for PR and issue operations,
plus an optional GitHub Issues-backed `TaskProvider`.

- Requires `modules.github.token` (PAT or `$ENV_VAR` reference).
- Write tools (`github_merge_pr`, `github_close_pr`, `github_create_issue`, `github_update_issue`, `github_add_label`, `github_remove_label`) are classified as dangerous by guardrails and queue for approval in autonomous mode.
- No npm dependencies — uses `fetch` with GitHub REST API v2022-11-28.

## Files

- `index.ts` — `KotaModule` definition; implements all tools inline with config wiring and `$ENV_VAR` token resolution; registers `GitHubTaskProvider` in `onLoad` when `taskProvider.enabled` is set.
- `task-provider.ts` — `GitHubTaskProvider` class implementing the `TaskProvider` interface backed by GitHub Issues; issues cached at init, mutations (claim/complete) fire async GitHub API calls.
- `github.test.ts` — unit tests for GitHub tool implementations.
- `github-task-provider.test.ts` — unit tests for `GitHubTaskProvider` covering init, list, claim, complete, add, archiveCompleted, and the onLoad integration.

## Boundaries

- Does not own webhook ingestion (that belongs in `github-webhook/`).
- Does not own git CLI operations (those belong in `git/`).
- Token is never logged or included in error messages.
