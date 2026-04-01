---
id: task-workflow-cost-anomaly-alerts
title: Emit alerts when workflow run cost significantly exceeds historical baseline
status: ready
priority: p3
area: operator-ux
summary: KOTA tracks per-run cost and per-workflow daily budgets, but does not flag individual runs that cost anomalously more than usual. An automatic anomaly alert would help operators catch runaway sessions before they exhaust the daily budget.
created_at: 2026-03-31T13:03:00Z
updated_at: 2026-03-31T13:03:00Z
---

## Problem

`WorkflowRunStore` persists `totalCostUsd` for each run, and `BudgetGuard` emits `workflow.budget.exceeded` when daily spend crosses a threshold. But there is no mechanism to detect when a single run costs 3× or 5× more than the rolling average for that workflow — a signal that something went wrong (runaway repair loop, unexpectedly deep task, token explosion).

Operators discover cost spikes only after the fact by reviewing `kota workflow stats` or by noticing the daily budget has been consumed early.

## Desired Outcome

After each workflow run completes, the runtime computes the run's cost relative to the rolling average (e.g., last 10 completed runs) for the same workflow. If the cost exceeds a configurable multiple (default: 3×) of that baseline, it emits a `workflow.cost.anomaly` bus event. Telegram, webhook, and other notification extensions subscribe to this event and alert the operator.

The anomaly threshold is configurable per-workflow in the workflow definition or daemon config:

```json
{ "costAnomalyThreshold": 3.0 }
```

## Constraints

- Baseline is computed from completed non-failed runs only; failed runs are excluded to avoid skewing the average down.
- Require at least 3 historical runs before anomaly detection fires; skip silently on first few runs.
- Do not introduce a new persistence layer; use `WorkflowRunStore` to retrieve historical run metadata.
- Keep detection logic inside the workflow runtime layer, not in notification extensions.
- The new `workflow.cost.anomaly` event type must be added to `BusEvents` in `src/event-bus-types.ts`.

## Done When

- `workflow.cost.anomaly` is defined in `BusEvents`.
- The runtime emits it after a run where cost exceeds `costAnomalyThreshold × baseline`.
- Telegram and webhook extensions subscribe to and forward the event.
- At least one unit test verifies the anomaly threshold logic.
- The threshold is documented in `docs/DAEMON-API.md` or a workflow config reference.
