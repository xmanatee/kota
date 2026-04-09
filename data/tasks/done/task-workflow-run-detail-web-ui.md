---
id: task-workflow-run-detail-web-ui
title: Show workflow run detail view in web UI
status: done
priority: p2
area: web-ui
summary: Clicking a workflow run in the web UI sidebar should display a detail panel with step-by-step breakdown, cost, timing, and status — replacing the chat area or appearing inline.
created_at: 2026-03-20
updated_at: 2026-03-20
---

## Problem

The web UI sidebar lists recent workflow runs but clicking them does nothing. The only way to inspect a run's step outputs, cost breakdown, or step timing is via CLI or raw JSON files. This makes it hard to understand what the autonomous system did and why.

## Desired Outcome

Clicking a workflow run in the sidebar shows a detail view with: run ID, workflow name, status, duration, total cost, and a per-step breakdown (step name, status, duration, cost if available). The `/api/workflow/runs/:id` endpoint already returns full metadata — the UI just needs to use it.

## Constraints

- Use the existing `/api/workflow/runs/:id` endpoint; do not add new backend routes.
- Detail view replaces or overlays the main chat area when a run is selected.
- Step outputs may be large; show a truncated preview, not the full payload.
- No framework dependencies — keep it in the existing vanilla JS client.

## Done When

- Clicking a run item in the sidebar fetches `/api/workflow/runs/:id` and renders a detail panel.
- Detail panel shows: run ID, workflow, status, started/completed timestamps, total cost, and per-step rows.
- Clicking "Back" or starting a new chat returns to the chat view.
- No new backend code required.
