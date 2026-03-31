---
id: task-web-ui-run-history-load-more
title: Add load-more pagination to web UI run history panel
status: backlog
priority: p3
area: operator-ux
summary: The run history panel fetches at most 50 runs on load and has no way to see older runs. Active KOTA instances accumulate hundreds of runs; operators have no browser-based way to page through them.
created_at: 2026-03-31T22:36:31Z
updated_at: 2026-03-31T22:36:31Z
---

## Problem

`client-workflows.ts` fetches `/api/workflow/runs?limit=50` once on panel open. Operators
with busy daemons hit this cap quickly and cannot reach older runs without using the CLI
(`kota workflow history`). The server already supports `offset` and `limit` query params
on both the local runs route and the daemon API proxy, but the web UI does not use them.

## Desired Outcome

A "Load more" button appears at the bottom of the run history list when the last fetch
returned a full page of results. Clicking it appends the next page (`offset += limit`)
without replacing existing rows. The button disappears when a partial page is returned
(signalling the end of history).

## Constraints

- Use the existing `offset` + `limit` query params already supported server-side.
- Append rows to the existing list; do not full-reload.
- Do not paginate with numbered pages — a single "Load more" button is sufficient.
- Keep page size at 50 (matches the current fetch).
- No new server routes or dependencies.

## Done When

- A "Load more" button appears after the initial 50 rows when more runs exist.
- Clicking it fetches the next 50 runs and appends them to the list.
- The button is hidden after a page with fewer than 50 results is returned.
- The button is hidden while a fetch is in progress (prevent double-click).
