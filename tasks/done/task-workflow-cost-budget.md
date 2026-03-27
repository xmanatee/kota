---
id: task-workflow-cost-budget
title: Add per-workflow daily cost budget with auto-pause
status: done
priority: p2
area: workflows
summary: Builder runs cost ~$6.50/day and improver ~$3.30/day with no enforcement mechanism. Operators need a way to set daily spend limits per workflow so runaway autonomous cycles don't accumulate unbounded cost.
created_at: 2026-03-27T16:12:00Z
updated_at: 2026-03-27T16:23:00Z
---

## Problem

Autonomous workflows (builder, improver, explorer) run on idle triggers and accumulate cost with no upper bound. Today's observed spend ($6.5 builder + $3.3 improver + $2.5 explorer = $12.3/day) requires the operator to manually monitor `kota workflow list` or run cost summaries. There is no automatic brake.

## Desired Outcome

- A `dailyBudgetUsd` field on workflow definitions (or in kota config) that sets a per-workflow daily spend cap.
- Before starting a new workflow run, the runtime checks total spend for that workflow in the last 24h against its budget.
- If the budget is exceeded, the run is skipped and a log message notes the reason.
- `kota workflow list` or `kota workflow status` surfaces budget utilization alongside run counts.

## Constraints

- Budget enforcement is best-effort (it reads completed run costs, not in-progress spend).
- If cost data is unavailable for a run, treat it conservatively (count as $0, do not block).
- Do not block the current run if budget data cannot be read — log a warning and proceed.
- Default: no budget (current behavior preserved unless configured).
- Budget config should live close to the workflow definition, not scattered across env files.

## Done When

- `dailyBudgetUsd` can be set per workflow in the workflow definition or manifest config.
- A workflow run that would exceed the daily budget is skipped with a log message.
- `kota workflow list` shows today's spend vs. budget for each workflow that has a budget set.
- `npm run typecheck` and `npm test` pass.
