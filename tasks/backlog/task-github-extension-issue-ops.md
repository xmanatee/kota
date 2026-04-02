---
id: task-github-extension-issue-ops
title: Add issue write operations to GitHub extension (create, update, label)
status: backlog
priority: p3
area: extensions
summary: The GitHub extension can list and comment on issues but cannot create issues, update their state, or manage labels. These operations are needed by the builder for task tracking and are a prerequisite for the GitHub Issues task provider.
created_at: 2026-04-02T01:51:00Z
updated_at: 2026-04-02T01:51:00Z
---

## Problem

The GitHub extension provides `github_list_issues` and `github_comment` but has no
tools for write operations on issues. Workflows that need to track progress in
GitHub Issues (e.g., mark an issue in-progress, add a completion label, close an
issue after a builder run, or create a tracking issue for a discovered problem)
cannot do so without manual operator intervention.

This gap also blocks the GitHub Issues task provider (`task-github-issues-task-provider`)
because that provider requires claim (label add), unclaim (label remove), and complete
(close) operations on issues.

## Desired Outcome

Three new tools added to the GitHub extension following the existing factory pattern:

- **`github_create_issue`**: create a new issue with title, optional body, labels, and
  assignees. Returns the new issue number and URL.
- **`github_update_issue`**: update an existing issue's state (`open`/`closed`), title,
  or body by issue number.
- **`github_add_label`** / **`github_remove_label`**: add or remove a label from a PR
  or issue by number. Can be a single combined tool with an `action: "add" | "remove"`
  field, or two separate tools — follow the pattern that fits best with existing tools.

All tools use the existing `githubFetch` helper and `defaultRepo` fallback pattern.

## Constraints

- Follow the existing factory pattern (`makeXxx(token, defaultRepo)`) exactly — no new
  abstractions.
- `github_create_issue` and `github_update_issue` are classified dangerous by guardrails
  (modify repo state). `github_add_label` / `github_remove_label` are classified
  dangerous in autonomous mode (per existing pattern for state-changing tools).
- Update `requireApproval` default list to include the new write tools, consistent with
  the existing PR write tools.
- Add all new tools to the JSDoc header and `src/extensions/AGENTS.md` entry.
- Unit tests follow the same `vi.fn()` / response-mock pattern as existing github tests.

## Done When

- `github_create_issue`, `github_update_issue`, and label management tool(s) are
  implemented and exported by the extension.
- Guardrails classify them as dangerous.
- JSDoc header, AGENTS.md, and any relevant docs are updated.
- Unit tests covering success and API-error paths are passing.
- Existing 15 GitHub extension tests continue to pass.
