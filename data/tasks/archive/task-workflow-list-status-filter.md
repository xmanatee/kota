---
status: done
---

# Add --status filter to kota workflow list

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
