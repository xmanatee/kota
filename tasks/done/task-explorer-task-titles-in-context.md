---
id: task-explorer-task-titles-in-context
title: Include task titles and summaries in explorer gather-context output
status: done
priority: p2
area: workflow
summary: The explorer's gather-context step provides task counts but not task content. When the explorer agent decides what to create or modify, it must read task files explicitly via tool calls. Including a brief snapshot of ready and backlog task titles and summaries in the pre-packaged context would reduce redundant tool reads and help the explorer avoid creating duplicate tasks.
created_at: 2026-03-27
updated_at: 2026-03-27
---

## Problem

`gatherExplorerContext` returns `taskCounts` (counts by state) but no task content. The explorer prompt instructs the agent not to re-fetch counts via tool calls, but the agent routinely reads task files anyway to check for duplicates or understand priorities. This adds turns and cost to every explorer run without adding value.

The explorer's job — deduplication, prioritization, restocking — depends on knowing what tasks already exist, not just how many.

## Desired Outcome

- `gatherExplorerContext` reads the task titles and summaries from `tasks/ready/` and `tasks/backlog/`.
- Returns a new field `openTaskSummaries: { id: string; title: string; summary: string; status: string; priority: string }[]`.
- Explorer prompt updated to state that `openTaskSummaries` is available and to use it before reading task files.
- Limit to ready + backlog (not doing, blocked, done) to keep context size bounded.

## Constraints

- Read task frontmatter only — do not include full task bodies in the context object.
- If a task file has no summary field, include it with an empty string.
- Keep the list compact; skip AGENTS.md files.
- Update the explorer prompt's context section to document the new field.

## Done When

- `gatherExplorerContext` returns `openTaskSummaries` with one entry per ready/backlog task.
- The explorer prompt references `openTaskSummaries` in its context section.
- Tests cover: tasks present in both states, one state empty, both states empty.
