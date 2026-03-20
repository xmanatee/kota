---
id: task-workflow-run-history-stats
title: Add aggregate run history stats to kota workflow CLI
status: done
priority: p3
area: workflow-cli
summary: Add a `kota workflow history` subcommand to show aggregate metrics (run count, success rate, avg/total cost, avg duration) filterable by workflow name and time window.
created_at: 2026-03-20
updated_at: 2026-03-20
---

## Problem

`kota workflow list` shows individual runs but provides no aggregated view. There is no way to answer "how healthy is the explorer workflow over the last week?" or "what is the average cost per builder run?".

## Desired Outcome

`kota workflow history [--workflow <name>] [--days <n>]` prints a summary table with:
- Total runs, success/failure counts, success rate
- Total and average cost (USD)
- Average and p95 duration
- Optionally broken down per workflow name

## Constraints

- Read from existing `.kota/runs/` metadata already written by the runtime; no new storage schema needed
- `task-workflow-run-cost-tracking` is done; per-run cost is available in run metadata
- Output should degrade gracefully if cost data is missing on older runs

## Done When

- `kota workflow history` prints aggregate stats from run metadata
- `--workflow` and `--days` filters work correctly
- Works alongside existing `list` and `status` commands without overlap
