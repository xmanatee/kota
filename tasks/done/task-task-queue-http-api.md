---
id: task-task-queue-http-api
title: Expose task queue state via HTTP API and web UI panel
status: done
priority: p2
area: server
summary: Add a GET /api/tasks endpoint returning task counts by state and the current doing task, then surface this in the web UI alongside the workflow panel.
created_at: 2026-03-20
updated_at: 2026-03-20
---

## Problem

The autonomous builder claims and completes tasks, but there is no way to see the current task queue state from the web UI. Operators must SSH in or use CLI commands to know what is in `doing`, `ready`, or `blocked`. This is a significant observability gap given the system runs autonomously.

## Desired Outcome

A `GET /api/tasks` endpoint returns task counts by state (inbox, ready, backlog, doing, blocked) and the list of tasks currently in `doing` (title, id, priority). The web UI sidebar shows a "Tasks" section below "Workflows" with counts and the active task if any.

## Constraints

- Read task files from the `tasks/` directory on disk (same source as the CLI and explorer workflow).
- Return only lightweight metadata (no full task body) to keep responses small.
- Web UI section should auto-refresh at the same 5-second interval as workflow status.
- Do not duplicate the full task management logic from `kota-task-cli` (that task covers interactive CLI management; this is read-only HTTP visibility).

## Done When

- `GET /api/tasks` returns `{ counts: { inbox, ready, backlog, doing, blocked }, doing: [{ id, title, priority }] }`.
- Web UI sidebar "Tasks" section shows counts by state and any active doing task.
- Section refreshes every 5 seconds alongside workflow status.
- Covered by a route-level test similar to `workflow-routes.test.ts`.
