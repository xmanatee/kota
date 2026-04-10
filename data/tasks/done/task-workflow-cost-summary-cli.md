---
id: task-workflow-cost-summary-cli
title: Add workflow cost summary CLI command
status: done
priority: p2
area: operator-experience
summary: Operators have no CLI view of per-workflow cost trends. Add a kota workflow cost command that shows total and per-run spend by workflow, helping operators spot expensive or runaway automations.
created_at: 2026-04-10T06:50:00Z
updated_at: 2026-04-10T08:22:00Z
---

## Problem

`kota workflow runs` lists recent runs and `kota workflow stats` shows aggregate counts, but there is no CLI surface that lets operators quickly answer "which workflows are costing the most?" or "how much did my builder spend this week?". Cost data is stored in run artifacts (`WorkflowRunStore`) and exposed via `GET /workflow/runs` in the daemon API, but it is not surfaced in a cost-oriented CLI view. Operators either read raw JSON or calculate manually.

## Desired Outcome

`kota workflow cost [--workflow <name>] [--days <n>] [--json]` reads run artifacts (or the daemon API when running) and outputs a ranked summary:

- Default: all workflows, last 7 days.
- Per-workflow rows: total spend ($), run count, average cost per run, most expensive single run.
- `--workflow <name>`: drill into one workflow showing per-run breakdown.
- `--days <n>`: adjust the lookback window.
- `--json`: machine-readable output.

The command lives in the `workflow` module (`src/modules/workflow/`), alongside `run-cost.ts` and the other workflow CLI helpers. It should use the existing `WorkflowRunStore` and cost data already tracked per run.

## Constraints

- Read from daemon API (`GET /workflow/runs`) when daemon is running; fall back to direct run artifact reads when offline.
- Do not add new persistence or new API endpoints — use existing run artifact data.
- Update `docs/DAEMON-API.md` only if a new endpoint is required (it should not be).
- Add the new command to the workflow module's `commands` contribution.

## Done When

- `kota workflow cost` prints a ranked cost summary table.
- `kota workflow cost --workflow builder --days 3` drills into builder runs for 3 days.
- `kota workflow cost --json` outputs valid JSON.
- `pnpm run typecheck`, `pnpm run lint`, `pnpm test`, and `pnpm build` all pass.
