---
id: task-workflow-run-cost-tracking
title: Aggregate and surface per-run and historical workflow cost
status: backlog
priority: p3
area: workflow
summary: Each agent step records totalCostUsd in its metadata, but there is no aggregated view of per-run cost or historical cost trends. Surface this in run metadata and the CLI inspect command.
created_at: 2026-03-20
updated_at: 2026-03-20
---

## Problem

`WorkflowRunMetadata` stores step results including `totalCostUsd` per agent step, but the run-level metadata has no total cost field. Operators cannot easily tell how much an autonomous cycle (explorer + builder + improver) cost without summing across files manually. Over many runs, cost trends are invisible.

## Desired Outcome

- Run metadata includes a `totalCostUsd` field summed across all agent steps at finish time
- `WorkflowRunStore.finish()` computes and writes this aggregate
- `kota workflow list` shows per-run cost
- `kota workflow status` shows aggregate cost across all runs in the current session (since daemon start)

## Constraints

- Blocked by `task-workflow-cli-inspect` (CLI must exist first)
- Cost sum should only cover agent steps; code and tool steps contribute zero
- No breaking changes to the metadata schema — existing run files without `totalCostUsd` should be treated as unknown/zero

## Done When

- Run metadata includes `totalCostUsd`
- CLI inspect surfaces this data
- Tests cover the aggregate calculation
