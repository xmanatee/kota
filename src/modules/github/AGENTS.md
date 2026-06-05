# GitHub Module

This directory owns the GitHub REST API capability pack — typed tools for PR and issue operations,
plus an optional GitHub Issues-backed `TaskProvider`.

- Requires `modules.github.token`, preferably as a `$GITHUB_TOKEN` secret
  reference declared through the module setup requirements. Raw PATs and env
  references are still resolved for existing configs.
- Write tools (`github_comment`, `github_merge_pr`, `github_close_pr`, `github_create_issue`, `github_update_issue`, `github_add_label`, `github_remove_label`) are classified as dangerous by guardrails and queue for approval in autonomous mode.
- No npm dependencies — uses `fetch` with GitHub REST API v2022-11-28.

## Boundaries

- Does not own webhook ingestion (that belongs in `github-webhook/`).
- Does not own git CLI operations (those belong in `git/`).
- Token is never logged or included in error messages.
