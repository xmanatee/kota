---
id: task-workflow-stats-cli
title: Add kota workflow stats command for aggregate run health summary
status: done
priority: p3
area: cli
summary: Operators have no quick way to see overall workflow health — success rates, error patterns, and cost trends require piecing together output from kota workflow history and kota workflow cost. A stats command would surface this in one view.
created_at: 2026-03-31T06:00:00Z
updated_at: 2026-03-31T06:27:52Z
---

## Problem

`kota workflow history` lists individual runs and `kota workflow cost` shows cost breakdowns, but there is no single command that gives a health overview: success rate per workflow, failure trend over time, average run duration, and total spend in a period. Operators must aggregate this manually or write scripts against `.kota/runs/`.

## Desired Outcome

`kota workflow stats [--days <n>] [--workflow <name>] [--json]` prints an aggregate health table:

```
Workflow    Runs  Success  Failed  Avg Duration  Total Cost
builder     12    10       2       18m           $1.24
explorer    8     8        0       4m            $0.42
improver    4     3        1       8m            $0.18
```

- Default window: last 7 days. `--days` adjusts the window.
- `--workflow <name>` filters to one workflow.
- `--json` emits machine-readable output.
- Data comes from `WorkflowRunStore` (same source as `kota workflow history`).

## Constraints

- Read-only; no daemon connection required — reads run artifacts directly from `.kota/runs/`.
- Follow the existing pattern in `src/workflow-cli/run-cost.ts` for data aggregation and CLI option handling.
- Register under `kota workflow stats` alongside existing `kota workflow` subcommands.
- Duration calculation uses the existing `run.duration` or computed from `startedAt`/`completedAt` in the run record.

## Done When

- `kota workflow stats` prints the table described above for the default 7-day window.
- `--days`, `--workflow`, and `--json` flags work as described.
- Output is consistent with how `kota workflow cost` presents data (same style/formatting conventions).
- At least one test covers the aggregation logic.
- Command appears in `kota workflow --help`.
