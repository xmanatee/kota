---
id: task-workflow-cost-budget
title: Enforce configurable daily cost budget for autonomous workflow runs
status: backlog
priority: p2
area: workflow
summary: The workflow runtime has no spending limit. A misconfigured cron trigger or runaway workflow can accumulate unbounded API costs. Add a configurable daily budget that pauses dispatch and notifies via Telegram when the limit is reached.
created_at: 2026-03-20
updated_at: 2026-03-20
---

## Problem

KOTA runs autonomously with cron and interval triggers. Each workflow run incurs API cost (tracked per-step as `totalCostUsd`), but there is no ceiling. A misconfigured trigger, a looping step, or simply higher-than-expected usage can silently drive up spend. Operators only discover this after the fact when reviewing billing.

## Desired Outcome

- A `dailyBudgetUsd` field in `.kota/config.json` sets the maximum API spend per calendar day (UTC).
- The workflow runtime tracks cumulative cost across runs for the current day. When the budget is reached, dispatch is paused automatically and a Telegram notification is sent.
- `kota workflow status` shows today's spend and the configured budget.
- Dispatch resumes automatically at the start of the next UTC day (daily reset), or operators can force-resume with `kota workflow resume`.

## Constraints

- Depends on per-run cost aggregation being stored in run metadata (see task-workflow-run-cost-tracking).
- Daily spend is computed by summing completed run costs since UTC midnight; no separate ledger file needed.
- If no budget is configured, the system behaves as today (unlimited).
- Budget enforcement must not affect runs already in progress — only new dispatch is blocked.

## Done When

- Dispatch pauses when cumulative daily cost exceeds `dailyBudgetUsd`.
- Telegram notification sent at pause time with spend and budget figures.
- `kota workflow status` reflects today's spend vs budget.
- Tests cover budget threshold detection and automatic daily reset.
