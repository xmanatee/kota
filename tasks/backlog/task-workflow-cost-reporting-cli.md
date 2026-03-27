---
id: task-workflow-cost-reporting-cli
title: Add workflow cost reporting to the CLI
status: backlog
priority: p2
area: cli
summary: The workflow runtime tracks per-run cost and daily spend but there is no CLI surface to view them. Operators must dig through run artifact JSON files to understand what autonomous workflows are spending.
created_at: 2026-03-27T22:43:00Z
updated_at: 2026-03-27T22:43:00Z
---

## Problem

`BudgetGuard` tracks daily spend and `WorkflowRunStore.getDailySpendUsd()` is
available, but there is no operator-facing CLI command to query it. The only
visibility into cost is:

- Telegram alerts when budget is hit
- Raw JSON in `.kota/runs/<run-id>/` files
- `kota workflow show <run-id>` which shows some cost info for a single run

Operators running autonomous agents cannot easily answer: "How much did
yesterday's builder runs cost?" or "What is today's total spend?" without
manual JSON inspection. Budget pause/resume decisions are made in the dark.

## Desired Outcome

- `kota workflow cost` — show today's spend, yesterday's spend, and a rolling
  7-day total across all workflows.
- `kota workflow cost --workflow builder` — filter by workflow name.
- `kota workflow cost --days 30` — extend the lookback window.
- Costs are broken down per-workflow with per-run detail available via a flag.

## Constraints

- Use `WorkflowRunStore` and the existing run artifact structure — do not add
  a new store or duplicate cost tracking.
- Follow the existing `workflow-cli/` pattern and register as a subcommand of
  the existing `kota workflow` group.
- Output should be human-readable (table format) by default; add `--json` flag
  for machine-readable output.
- Do not re-implement cost parsing — check if `run-show.ts` or `run-list.ts`
  already extract cost fields and reuse that logic.

## Done When

- `kota workflow cost` prints today's total spend and a per-workflow breakdown.
- `kota workflow cost --days 7` works and shows a multi-day breakdown.
- The command appears in `kota workflow --help`.
- No new persistence layer is added; everything comes from existing run artifacts.
