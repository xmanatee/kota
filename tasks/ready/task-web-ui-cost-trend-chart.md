---
id: task-web-ui-cost-trend-chart
title: Add daily cost trend sparkline to web UI cost panel
status: ready
priority: p3
area: web-ui
summary: The web UI cost panel shows totals per workflow over a selected time window but no day-by-day breakdown. A simple sparkline or bar chart of daily spend would let operators spot cost anomalies or trends without switching to a Prometheus/Grafana stack.
created_at: 2026-04-02T07:00:00Z
updated_at: 2026-04-02T09:32:00Z
---

## Problem

The cost panel (`client-cost.ts`) shows aggregate spend per workflow for 24h / 7d / 30d
windows and a list of the top runs by cost. It does not show how spend is distributed
across days. An operator cannot tell from the panel whether costs are stable, spiking,
or trending upward over the selected window without exporting and analyzing run data
manually.

`GET /api/workflow/runs` returns all runs with `startedAt`, `durationMs`, and `costUsd`
fields. Daily totals can be computed client-side by bucketing runs by calendar day.

## Desired Outcome

When the 7d or 30d window is selected, the cost panel renders a compact day-by-day bar
chart (inline SVG, no external library) above the per-workflow totals. Each bar
represents one calendar day's total spend across all workflows. A tooltip on hover shows
the date and total. The 24h window shows an hourly breakdown instead (24 bars).

The chart reuses the run data already fetched for the totals display — no additional API
calls.

## Constraints

- Use inline SVG only; do not add npm dependencies for charting.
- The chart is compact (height ≤ 80px) and fits within the existing panel width without
  horizontal scrolling.
- No new backend endpoints; compute from the existing `GET /api/workflow/runs` response.
- When no data exists for a day, render an empty bar (height 0) so the x-axis stays
  consistent.
- Degrades gracefully when the response has no `costUsd` fields (renders nothing rather
  than erroring).

## Done When

- The cost panel renders a day-by-day bar chart for the 7d and 30d windows.
- The 24h window renders an hourly bar chart.
- Hovering a bar shows date/hour and total spend.
- The chart is driven by the same run data as the totals list (no extra fetch).
- Manual verification: chart updates when the window selector changes.
