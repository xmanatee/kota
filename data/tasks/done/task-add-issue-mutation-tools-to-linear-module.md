---
id: task-add-issue-mutation-tools-to-linear-module
title: Add issue mutation tools to Linear module
status: done
priority: p2
area: modules
summary: The Linear module only provides a read-only TaskProvider. Add tools for creating issues, updating issue state, and adding comments so autonomous workflows can close the loop with Linear without manual intervention.
created_at: 2026-04-12T16:38:45.418Z
updated_at: 2026-04-12T18:53:56.736Z
---

## Problem

The Linear module (`src/modules/linear/`) only exposes a `LinearTaskProvider`
for reading issues from a Linear team's backlog. There are no tools for writing
back — creating issues, transitioning state, or posting comments. This means
any autonomous workflow that discovers work via Linear cannot report results,
update status, or file new issues without leaving the system.

The Jira module has the same limitation, but Linear is the more common
integration in this project's target audience.

## Desired Outcome

The Linear module contributes tools that allow agents to:
- Create a new issue in a configured team with title, description, priority,
  and optional label.
- Transition an existing issue to a named workflow state.
- Add a comment to an existing issue.

Tools use the existing `apiKey` config and Linear's GraphQL API. No new npm
dependencies.

## Constraints

- Reuse the existing Linear module config (`modules.linear.apiKey`, team key).
- Follow the tool contribution pattern used by other modules (e.g., github).
- Tools must validate required fields and return structured results, not raw
  GraphQL responses.
- Do not expose destructive operations (delete issue, remove label) in the
  initial set.

## Done When

- `linear_create_issue` tool creates an issue and returns its identifier and URL.
- `linear_update_issue_state` tool transitions an issue to a named state.
- `linear_add_comment` tool posts a comment on an existing issue.
- Each tool has co-located tests covering success and error paths.
- Module index registers the tools when the Linear config is present.
