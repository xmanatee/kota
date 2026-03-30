---
id: task-web-ui-schedule-management
title: Add workflow schedule management panel to the web UI dashboard
status: ready
priority: p3
area: operator-ux
summary: The daemon exposes /api/schedules for listing and managing workflow schedules, but the web dashboard has no panel for it. Operators must use CLI commands to view or control scheduled workflows.
created_at: 2026-03-31T00:00:00Z
updated_at: 2026-03-31T00:00:00Z
---

## Problem

Workflow cron and interval schedules are managed via `kota workflow` CLI subcommands
(`list`, `definitions`, etc.) but the web dashboard has no visibility into active
schedules. An operator watching the dashboard cannot see which workflows are scheduled,
when they last ran, or when they will next fire — without switching to the terminal.

The server already exposes `/api/schedules` (and related routes in `server-routes.ts`)
to support this; it is only the UI that is missing.

## Desired Outcome

A "Schedules" panel in the web UI dashboard that:
- Lists active workflow schedules with workflow name, trigger type (cron/interval), and
  next-run time.
- Shows last-run status (success/failed/never) for each schedule.
- Follows the same panel component pattern as the approvals, tasks, and sessions panels
  (SSE-updated, consistent layout).
- Refreshes automatically when schedule state changes via the existing SSE `/events`
  stream or polling of `/api/schedules`.

No schedule editing is required in this task — read-only display is enough.

## Constraints

- Use the existing SSE client wiring and panel component patterns from other panels.
- Inspect `/api/schedules` response shape in `server-routes.ts` before building the
  panel to confirm what fields are available.
- No new daemon API endpoints needed; use what `server-routes.ts` already exposes.
- Panel sits alongside the existing workflow, approvals, tasks, and sessions panels.

## Done When

- Schedules panel renders in the web UI showing active schedules from `/api/schedules`.
- Panel shows correct empty state when no schedules are active.
- Existing web UI tests pass; new behavior covered by at least one test.
