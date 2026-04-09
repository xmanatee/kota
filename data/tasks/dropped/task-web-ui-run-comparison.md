---
id: task-web-ui-run-comparison
title: Add run comparison view to web UI for spotting regressions between runs
status: dropped
priority: p3
area: web-ui
summary: Operators have no way to compare two runs of the same workflow side-by-side; a comparison view showing step diff, cost delta, and output changes would make regressions and improvements visible without manual log archaeology.
created_at: 2026-04-02T12:44:00Z
updated_at: 2026-04-09T04:20:00Z
dropped_reason: Already implemented. src/web-ui/client-run-detail-compare.ts provides _compareRunId state, renderCompareSection dropdown, and renderDiffTable with step status, duration, and cost deltas.
---

## Problem

When a workflow starts failing or producing different output, operators must open two run detail panels separately and compare them mentally. The run store captures per-step status, duration, cost, and output for every run, but there is no UI surface that diffs two runs. Debugging regressions after a builder commit, a model upgrade, or a config change requires navigating back and forth between individual run details.

## Desired Outcome

A "Compare" action in the run history list lets operators select two runs of the same workflow and view a comparison table showing:
- Step-by-step status diff (pass/fail/skip changes between runs)
- Per-step cost and duration delta
- Overall cost delta and run duration delta
- Whether the run outcome (success/failure) changed

The comparison view is accessible from the run list without leaving the web UI. No persistent state is needed; the comparison is computed on demand from the existing run detail API.

## Constraints

- Only compare runs of the same workflow (enforce this in the UI).
- The comparison must use existing `/api/runs/:id` data — no new backend endpoints required.
- Keep the view read-only; no workflow controls in the comparison pane.
- Step output content diff is optional for v1; focus on status, cost, and duration changes.

## Done When

- Operators can select two runs from the run history list and open a comparison view.
- The comparison table shows step status diff, cost delta, and duration delta.
- A summary line indicates whether the outcome changed (e.g., "failure → success").
- The feature is reachable from the existing workflow run history panel without a page reload.
