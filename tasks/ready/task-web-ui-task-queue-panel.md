---
id: task-web-ui-task-queue-panel
title: Add task queue panel to the web UI
status: ready
priority: p2
area: ui
summary: The web UI shows workflow runs and cost but has no visibility into the task queue. Adding a task panel — listing tasks by state with title, priority, and summary — would let operators monitor and manage the work queue without needing CLI access. The task HTTP API already exists.
created_at: 2026-03-27
updated_at: 2026-03-27
---

## Problem

Operators using the web UI can monitor workflow runs and costs but cannot see what tasks are queued, what the builder is working on, or what is in the backlog. Managing tasks (moving state, checking attempt history) requires CLI access or direct file editing.

The `task-queue-http-api` work is already done — the task API exists. The gap is a UI layer.

## Desired Outcome

- New "Tasks" tab or panel in the web UI.
- Lists tasks grouped by state: ready, doing, backlog, blocked.
- Each row shows: title, priority, area, and a one-line summary.
- Clicking a task expands it to show the full task body (markdown rendered).
- Read-only in the first pass; no mutation needed.

## Constraints

- Use the existing task HTTP API — do not add new server endpoints.
- Keep the panel consistent with the existing web UI style.
- done/dropped tasks are excluded from the panel (or shown in a collapsed "recent" section).
- No real-time push needed; poll on mount or on tab focus.

## Done When

- Task panel renders tasks by state using the existing HTTP API.
- Full task body is visible on expand/click.
- Panel is accessible from the main web UI navigation.
- done/dropped tasks are hidden or collapsed by default.
