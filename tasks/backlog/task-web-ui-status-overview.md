---
id: task-web-ui-status-overview
title: Add system status overview panel to web UI
status: backlog
priority: p3
area: web-ui
summary: The web UI has individual panels for workflows, approvals, cost, extensions, and tasks, but no single place that shows overall system health at a glance. An overview panel aggregating daemon uptime, budget remaining, dispatch window status, and recent failure rate would give operators a fast orientation on open.
created_at: 2026-04-02T10:06:24Z
updated_at: 2026-04-02T10:06:24Z
---

## Problem

When an operator opens the web UI they must scan multiple panels to answer "is everything OK right now?". Common orientation questions include:

- Is the daemon healthy and for how long has it been running?
- How much of the daily cost budget remains?
- Is the dispatch window currently open or blocked?
- How many runs failed or completed-with-warnings in the last hour?
- Are any extensions in a degraded/dead state?

Today answering these requires checking the daemon status badge, the cost panel, the extensions panel, and the workflow history filter separately.

## Desired Outcome

A compact "Overview" or "Status" panel rendered near the top of the sidebar (or as the default landing section) that pulls from already-available API data and shows:

- Daemon uptime and start time (from `GET /api/daemon/status`)
- Budget used today / daily limit and percent remaining (from cost data already fetched for the cost panel)
- Dispatch window: open / blocked until `<time>` (from `runtime.dispatchWindow` in daemon status)
- Recent run health: counts of success / failed / warnings in the last hour
- Extension health summary: N extensions OK, M degraded/dead (from `GET /api/extensions`)

All data is available without new API endpoints. The panel should refresh on the same SSE event cadence as existing panels.

## Constraints

- No new API endpoints; reuse data from existing endpoints.
- Keep the panel compact — it is a summary, not a duplicate of each individual panel.
- Follow the existing section module pattern (`client-*.ts` files, assembled in `client.ts`).
- Avoid duplicating fetch logic: where the data is already fetched (e.g., extensions), read from the cached result rather than issuing a second request.

## Done When

- An Overview/Status panel appears in the web UI with the six data points listed above.
- All values update on SSE events without a full page reload.
- No new daemon API endpoints are needed.
- Manual verification: degraded extension state is reflected in the overview badge.
