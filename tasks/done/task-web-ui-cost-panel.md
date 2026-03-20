---
id: task-web-ui-cost-panel
title: Add cost summary panel to web UI
status: done
priority: p2
area: web-ui
summary: The web UI has panels for workflows and tasks but no visibility into spend. A cost panel showing per-workflow totals and a rolling daily burn rate would close the observability gap and surface runaway spend early.
created_at: 2026-03-20
updated_at: 2026-03-20
---

## Problem

KOTA's autonomous loop has measurable per-run and per-workflow costs tracked in run history, but the web UI exposes none of this. The only way to check spend is by querying `.kota/runs/` directly or reading gather-context output. As run frequency increases, cost overruns can go unnoticed.

## Desired Outcome

- A Cost panel in the web UI sidebar (alongside Workflows and Tasks) shows per-workflow spend totals for the last 24h.
- A secondary row shows total across all workflows for the same window.
- Data comes from a new `/api/cost/summary` endpoint (or reuses the existing runs API with client-side aggregation if simpler).
- Refreshes on the same interval as other panels.

## Constraints

- No framework dependencies — keep it vanilla JS like the rest of the client.
- If aggregating client-side from `/api/workflow/runs`, do not add a new backend endpoint unless it's clearly simpler.
- Do not add per-step cost breakdown here; run-level totals are sufficient.
- 24h window is the default; do not add configurable date ranges in this task.

## Done When

- Cost panel renders in the web UI with per-workflow totals and an all-workflows total for the last 24h.
- Values update on page refresh or on the standard poll interval.
- Panel handles the empty-state (no runs in window) gracefully.
