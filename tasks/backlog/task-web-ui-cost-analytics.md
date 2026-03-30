---
id: task-web-ui-cost-analytics
title: Add cost and performance analytics panel to the web UI dashboard
status: backlog
priority: p3
area: operator-ux
summary: The web dashboard shows workflow run history and status but no aggregate cost or performance summary. An analytics panel gives operators a visual overview of where spend is concentrated without using the CLI.
created_at: 2026-03-30T20:33:00Z
updated_at: 2026-03-30T20:33:00Z
---

## Problem

The web dashboard surfaces per-run status and workflow history but offers no aggregate
view of cost or performance. Operators who want to understand total spend, identify
expensive workflows, or spot performance regressions must run `kota workflow cost` in
the CLI or inspect individual run records manually. There is no visual summary, no
trends, and no way to see top-cost runs at a glance from the dashboard.

## Desired Outcome

An Analytics panel in the web dashboard showing:
- Total cost for a configurable recent window (e.g. last 7 days / last 30 runs).
- Per-workflow cost breakdown as a table or bar chart.
- Top-N most expensive individual runs with links to their history detail.
- Average step duration per workflow (stretch; skip if not available from existing data).

The panel updates after new runs complete via the existing SSE stream — no manual
refresh required.

## Constraints

- Source all data from the daemon control API (`GET /workflow/history`). Add time-range
  or limit query params if the current endpoint does not support them; do not create a
  separate analytics endpoint.
- If `cost` fields are missing from history API responses today, add them there rather
  than building a parallel data path.
- Use the same SSE wiring as other panels; update on `workflow.completed` events.
- Keep the panel read-only; no actions or controls needed.
- Use the same component and styling patterns as existing dashboard panels.

## Done When

- Analytics panel renders with cost breakdown and top-cost runs from daemon API data.
- Panel updates on `workflow.completed` SSE event without full page reload.
- Per-workflow cost table and top-N run list are visible and accurate.
- Existing dashboard panels and tests are unaffected.
- At least one render test covers the new panel.
