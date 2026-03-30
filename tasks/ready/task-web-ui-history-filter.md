---
id: task-web-ui-history-filter
title: Add filter and search to the workflow run history panel in the web UI
status: ready
priority: p3
area: operator-ux
summary: The web UI history panel lists all workflow runs in reverse chronological order with no way to filter by workflow name, status, or date. As run history grows, finding a specific run requires manual scrolling.
created_at: 2026-03-30T21:20:00Z
updated_at: 2026-03-30T21:20:00Z
---

## Problem

`client-workflows.ts` fetches and renders all workflow run history in a flat list.
With multiple workflows running daily, operators cannot quickly locate a failed
builder run from yesterday or all runs for a specific workflow without scrolling
through unrelated entries.

There is no filter bar, status toggle, or workflow name selector in the history panel.

## Desired Outcome

The workflow history panel gains a lightweight filter row with:
- A workflow name dropdown (derived from distinct names in the history response).
- A status filter (all / failed / completed / interrupted).
- A date range input or quick presets (today / last 7 days / all).

Filters apply client-side against the already-fetched history list. No new API
endpoints are needed.

## Constraints

- Client-side filtering only — do not add query params to `GET /workflow/history`.
- Filter state is ephemeral (no persistence); reset on page load.
- Fits the existing sidebar panel layout without horizontal overflow.
- No new dependencies; implement with plain DOM manipulation in the existing
  `client-workflows.ts` / `web-ui.ts` pattern.
- Existing web UI tests must continue to pass.

## Done When

- History panel has a filter row with workflow name, status, and date range controls.
- Changing any filter immediately updates the visible run list without a network request.
- Empty filter state shows full history (no regression from current behavior).
- `src/web-ui/AGENTS.md` notes the filter pattern for future panels.
