---
id: task-run-outcome-aggregation-for-improver
title: Add run-outcome aggregation to give the improver better signal
status: backlog
priority: p3
area: autonomy
summary: Extend the existing loadRecentRuns helper with lightweight aggregation so the improver can see patterns across runs, not just individual run metadata.
created_at: 2026-04-11T12:00:00Z
updated_at: 2026-04-11T12:00:00Z
---

## Problem

The improver workflow reads recent runs via `loadRecentRuns()` in
`src/modules/autonomy/shared.ts`, which returns the last 20 runs within a
24-hour window as flat metadata (status, cost, warnings). The improver sees
individual outcomes but cannot easily detect patterns: which workflows fail
most, which repair checks recur, whether cost per workflow is trending up, or
which error categories dominate.

This gap was identified during the runtime and self-improvement resource review
(April 2026). External runtimes like OpenFang track calibrated outcome accuracy
(Brier scores) across runs; MemPalace tracks temporal fact validity. KOTA does
not need those specific mechanisms, but the improver's effectiveness is limited
by the granularity of the signal it receives.

## Desired Outcome

A lightweight aggregation function (likely extending or complementing
`loadRecentRuns` and `computeCostByWorkflow` in `shared.ts`) that produces:

- Failure rate by workflow (last 24h and last 7 days).
- Most common repair-check failures (by check id).
- Cost-per-workflow trend (current window vs previous window).
- Run duration outliers.

The improver prompt or injected context should include this summary so it can
prioritize fixes that address systemic patterns rather than one-off failures.

## Constraints

- Keep it in `src/modules/autonomy/` — this is module-owned, not core.
- Read from existing `.kota/runs/` metadata; do not add new stores.
- Keep the aggregation synchronous and fast (no LLM calls).
- Do not change the run metadata schema.

## Done When

- The improver receives aggregated run-outcome data in its context.
- The aggregation covers failure rates, repair-check patterns, and cost trends.
- The improver prompt references the aggregated data.
