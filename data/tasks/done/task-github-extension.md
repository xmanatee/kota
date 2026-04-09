---
id: task-github-extension
title: Add GitHub extension with typed tools for PR and issue operations
status: done
priority: p3
area: extensions
summary: Builder and other agents currently shell out to the `gh` CLI for GitHub operations. A typed GitHub extension with structured tools (create PR, comment on issue, get CI status) would make GitHub interactions first-class and composable with other tools.
created_at: 2026-03-31T14:51:00Z
updated_at: 2026-04-01T11:56:00Z
---

## Problem

Agents that need GitHub operations (create PR, review CI status, comment on issues) currently invoke the `gh` CLI via shell commands in agent prompts. This is fragile — output is unstructured, error handling is manual, and there is no schema for callers. A proper extension with typed `ToolDef` entries would expose GitHub operations as first-class KOTA tools, composable with guardrails and telemetry like any other tool.

## Desired Outcome

A `github` extension in `src/extensions/github/` contributing the following tools:

| Tool | Description |
|------|-------------|
| `github_create_pr` | Create a pull request; inputs: `title`, `body`, `head`, `base`, `draft` |
| `github_get_pr` | Get PR details and CI check statuses by number |
| `github_list_issues` | List open issues with optional label filter |
| `github_comment` | Add a comment to a PR or issue by number |
| `github_merge_pr` | Merge a PR (squash/merge/rebase); gated behind operator approval by default |

Config (under `extensions.github`):
- `token`: GitHub personal access token or `$ENV_VAR` reference (required).
- `repo`: default owner/repo for calls that don't specify one (optional; falls back to `git remote`).
- `requireApproval`: list of tools that need an approval step before execution (default: `["github_merge_pr"]`).

Uses the GitHub REST API directly (`https://api.github.com`) via `fetch`; no additional npm dependencies required.

## Constraints

- Follow the extension contribution pattern in `src/extensions/` (compare Slack or Telegram extension structure).
- Do not invoke `gh` CLI; use the REST API directly for portability.
- Token must never appear in logs or run artifacts.
- Tools that mutate GitHub state (create PR, comment, merge) must be listed as high-risk in guardrails classification.
- Extension is only loaded if `extensions.github.token` is set; fail with a clear message otherwise.

## Done When

- `src/extensions/github/` exists with a valid `KotaExtension` factory.
- All five tools are registered with correct input schemas and descriptions.
- Integration test (mocked API) covers create PR, get PR with checks, and comment.
- Extension appears in `kota extension list` output.
- Type-checking and linting pass.
