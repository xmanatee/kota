---
id: task-web-ui-schedule-management
title: Add workflow schedule management panel to the web UI dashboard
status: ready
priority: p3
area: operator-ux
summary: The web dashboard has no panel showing which workflows have scheduled triggers, when they last ran, or when they fire next. Operators must switch to the terminal to use kota workflow definitions / kota workflow status.
created_at: 2026-03-31T00:00:00Z
updated_at: 2026-03-31T01:40:00Z
---

## Problem

Workflow cron and interval schedules are visible via `kota workflow definitions` and
`kota workflow status` in the CLI, but the web dashboard has no equivalent surface. An
operator watching the dashboard cannot see which workflows have scheduled triggers, when
they last ran, or when they will next fire — without switching to the terminal.

Note: `/api/schedules` in `server-routes.ts` returns user-created reminder items from
the `Scheduler` service (e.g., `remind me at 3pm`), not workflow cron/interval
triggers. The correct data source for workflow scheduling is `/api/workflow/status`,
which returns `workflows[name].nextScheduledAt`, `lastStatus`, and `lastCompletedAt`
from `WorkflowRuntimeState`. Trigger descriptions (cron expression, interval duration)
are not currently exposed via the daemon API.

## Desired Outcome

A "Schedules" panel in the web UI dashboard that:
- Lists workflows that have at least one scheduled trigger, showing workflow name,
  next-run time (`nextScheduledAt`), and last-run status.
- Shows last-run status (success/failed/never) for each scheduled workflow.
- Follows the same panel component pattern as the approvals, tasks, and sessions panels
  (consistent layout, refreshes on `workflow.completed` SSE events).

No schedule editing is required in this task — read-only display is enough.

## Constraints

- Source runtime schedule data from `GET /api/workflow/status` (field:
  `workflows[name].nextScheduledAt / lastStatus / lastCompletedAt`).
- Trigger-type descriptions (cron expression, interval) are available via
  `GET /workflow/definitions` on the daemon control API (`DaemonControlClient.getWorkflowDefinitions()`
  is already implemented). To expose this to the web UI, add a `GET /api/workflow/definitions`
  proxy route in `server-routes.ts` following the same pattern as the existing
  `/api/workflow/status` proxy.
- Panel sits alongside the existing workflow, approvals, tasks, and sessions panels.
- Use the existing SSE client wiring and panel component patterns from other panels.

## Done When

- Schedules panel renders in the web UI showing scheduled workflows with next-run time
  and last-run status from `/api/workflow/status`.
- Panel shows correct empty state when no workflows have scheduled triggers.
- Existing web UI tests pass; new behavior covered by at least one test.
