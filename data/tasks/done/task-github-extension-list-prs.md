---
id: task-github-extension-list-prs
title: Add github_list_prs and github_close_pr tools to the GitHub extension
status: done
priority: p3
area: extensions
summary: The GitHub extension can create, inspect, comment on, and merge PRs, but cannot list open PRs or close a PR without merging. These gaps mean the builder cannot check for an existing PR before creating a duplicate, and cannot clean up a stale branch PR.
created_at: 2026-04-02T01:06:00Z
updated_at: 2026-04-02T01:36:00Z
---

## Problem

`src/extensions/github/index.ts` provides `github_create_pr`, `github_get_pr`,
`github_list_issues`, `github_comment`, and `github_merge_pr`. There is no tool to:

1. List open PRs for a repository — needed when a workflow wants to check whether
   a PR already exists before creating a duplicate (e.g. the builder branch-per-task
   mode creating `kota/task/<id>` branches).
2. Close a PR without merging — needed to clean up or supersede a stale task branch
   PR without a full merge commit.

Without these, autonomous workflows must fall back to the `gh` CLI, which adds
a dependency and loses the extension's unified token handling and approval-gating.

## Desired Outcome

Two new tools in the GitHub extension:

- **`github_list_prs`**: Returns open (or filtered) PRs for the configured repo. Fields:
  number, title, branch, author, created_at, url, and draft status. Supports an optional
  `state` param (`open` | `closed` | `all`, default `open`) and optional `head` branch filter.

- **`github_close_pr`**: Closes a PR by number without merging. Requires the same
  `requireApproval` gating mechanism as `github_merge_pr` by default (configurable
  per the extension's `requireApproval` array).

Both tools use the existing `githubFetch` helper and follow the same config/token
resolution pattern as current tools.

## Constraints

- Follow existing tool factory pattern (`makeListPrs`, `makeClosePr`) — no new files.
- `github_close_pr` must be in `requireApproval` default list alongside `github_merge_pr`.
- No new npm dependencies; use the existing GitHub REST API v2022-11-28 via fetch.
- Unit tests for both tools alongside existing `github.test.ts` coverage.

## Done When

- `github_list_prs` returns a list of PRs with the documented fields.
- `github_close_pr` closes a PR by number and returns success/error result.
- Both tools respect the extension's `requireApproval` config.
- Unit tests cover list (with branch filter) and close (success and not-found cases).
- Extension JSDoc comment at the top of `index.ts` is updated to list both tools.
