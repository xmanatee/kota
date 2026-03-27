---
id: task-workflow-list-status-filter
title: Add --status filter to kota workflow list
status: done
priority: p3
area: workflow
summary: kota workflow list already supports --workflow to filter by name. Adding --status would allow operators to quickly find all failed or interrupted runs across all workflows (e.g. kota workflow list --status failed). Low complexity, high daily utility for debugging.
created_at: 2026-03-27
updated_at: 2026-03-27
---

## Problem

Operators debugging a run failure often want to see all recent failures at a glance. Today this requires scanning the full list manually or using `kota workflow history`, which aggregates stats rather than listing individual runs. There is no way to get a filtered list by status.

## Desired Outcome

- `kota workflow list --status <status>` filters the run list to runs with that status.
- Accepted values: `success`, `failed`, `interrupted`, `completed-with-warnings`, `running`.
- Combine with `--workflow` for cross-filter: `kota workflow list --workflow builder --status failed`.
- Print a helpful error if an unrecognized status value is passed.

## Constraints

- Implement in `src/workflow-cli/run-list.ts` alongside the existing `--workflow` filter.
- No changes to the underlying run store or metadata format.

## Done When

- `kota workflow list --status failed` returns only failed runs.
- `kota workflow list --workflow builder --status failed` combines both filters correctly.
- Unrecognized status prints a clear error message.
