---
id: task-web-ui-task-write-operations
title: Add task queue write operations to the web UI
status: done
priority: p2
area: operator-ux
summary: The web UI task panel is read-only. Operators who want to promote a backlog task to ready, drop a stale task, or capture a new inbox item must use the CLI. Adding write operations to the web UI closes this gap.
created_at: 2026-04-01T06:25:00Z
updated_at: 2026-04-01T06:25:00Z
---

## Problem

The web UI task panel (`client-tasks.ts`) displays tasks in all open states but provides no
write capability. To promote a backlog item to ready, drop a stale task, or create an inbox
entry, operators must context-switch to the CLI. The web UI is already the operator's primary
monitoring surface; task management is a natural module.

The task routes in `src/server/task-routes.ts` are read-only (`GET /api/tasks`). No HTTP
endpoints exist for task state transitions.

## Desired Outcome

- A `PATCH /api/tasks/:id/state` endpoint that moves a task file between state directories
  (`backlog` → `ready`, `ready` → `dropped`, etc.) and updates the `status` frontmatter field.
- A `POST /api/tasks` endpoint that creates a new inbox item (title required; body optional).
- In the web UI task panel: context menu or action buttons on each task row for
  "Promote to ready", "Move to backlog", and "Drop".
- A small "New task" form (title + optional summary) that creates an inbox item via the API.

## Constraints

- Task file moves must use `git mv` semantics (preserve git history). Use Node's `fs.rename`
  plus a `git add` call, or shell out to `git mv`, within the route handler.
- Only allow transitions between open states (`inbox`, `backlog`, `ready`, `blocked`).
  Moving to `done` or `dropped` requires explicit "Drop" action only.
- The endpoint should respect the same auth scope as other write operations
  (`control` scope if the daemon API proxies it, or the server's existing bearer-token guard).
- Do not modify the `task-cli.ts` CLI commands — this is a server + web-UI change only.

## Done When

- `PATCH /api/tasks/:id/state` moves the task file and updates status frontmatter.
- `POST /api/tasks` creates a new inbox item with the required frontmatter scaffold.
- The web UI task panel shows per-task action buttons (promote, drop) and a new-task form.
- Existing read-only task API and panel behavior is unchanged.
- Route handler tests cover the state-transition and create paths.
