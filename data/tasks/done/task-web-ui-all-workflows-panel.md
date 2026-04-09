---
id: task-web-ui-all-workflows-panel
title: Add all-workflows definitions panel to web UI
status: done
priority: p3
area: operator-ux
summary: The Schedules panel only shows cron/interval workflows. Event-triggered, idle-triggered, and webhook-triggered workflows are invisible in the web UI. Operators have no browser-based way to see what workflows are registered and what triggers they respond to.
created_at: 2026-03-31T22:36:31Z
updated_at: 2026-04-01T00:00:00Z
---

## Problem

`client-schedules.ts` filters `/api/workflow/definitions` to only cron and interval
workflows. Event-triggered workflows (e.g. `workflow.completed`), idle-triggered workflows,
and webhook-triggered workflows are invisible in the web UI. An operator cannot answer
"which workflows are registered?" or "what triggers explorer?" without using `kota workflow
definitions` on the CLI.

## Desired Outcome

A new "Workflows" panel in the web UI dashboard lists all registered workflow definitions.
For each workflow it shows:
- Name
- Trigger summary (cron schedule, event name, idle interval, webhook, or manual)
- Step count
- A "Trigger" button for manually triggerable workflows (re-uses the existing trigger
  call already present in `client-workflows.ts`)
- Last run status and timestamp (sourced from existing `/api/status` data)

The panel uses `/api/workflow/definitions` (already exists) and `/api/status` (already
exists). No new server routes are required.

## Constraints

- Do not replace or modify the Schedules panel — the new panel is additive.
- Follow the existing client module pattern (`src/web-ui/client-*.ts`).
- Reuse the trigger call already implemented in `client-workflows.ts` rather than
  duplicating it.
- No new dependencies.
- Trigger button should only appear for workflows that have a `manual: true` trigger or
  no time-based trigger (i.e. anything the operator can fire ad-hoc).

## Done When

- A "Workflows" panel lists all registered workflow definitions with name, trigger type,
  and last-run status.
- The Trigger button fires a manual run for eligible workflows.
- Panel populates from existing `/api/workflow/definitions` and `/api/status` endpoints.
