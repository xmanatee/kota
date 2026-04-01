---
id: task-macos-client-task-queue
title: Show task queue state in the macOS menu bar client
status: backlog
priority: p3
area: operator-ux
summary: The macOS menu bar client has no view of the task queue. Adding a compact task panel showing doing/ready counts and the current task lets operators quickly confirm the builder is working on the right thing without opening the web dashboard.
created_at: 2026-04-01T07:36:00Z
updated_at: 2026-04-01T07:36:00Z
---

## Problem

The macOS menu bar client shows daemon health, active runs, and pending approvals, but gives
no visibility into the task queue (`tasks/doing`, `tasks/ready`). When the builder is active,
operators cannot see which task it claimed without opening a browser tab or running `kota task list`.

The daemon control API already exposes `GET /tasks` with full queue counts and task details.
The macOS client does not use this endpoint.

## Desired Outcome

A compact "Task Queue" section in the menu bar popover:

- Shows the current `doing` task (id, title, priority) when one exists, otherwise shows "idle".
- Shows ready/backlog counts in a summary line (e.g. "3 ready · 12 backlog").
- Section is collapsible; collapsed by default when no doing task is present.
- Fetched from `GET /tasks` alongside the existing status poll.

The goal is quick glanceability, not a full task manager — the web UI handles that.

## Constraints

- No daemon changes required; `GET /tasks` is already documented in `docs/DAEMON-API.md`.
- Reuse `DaemonClient` fetch patterns from existing code.
- Keep the popover width at 280pt; use compact single-line rows.
- Do not add interactive task management (move, create, drop) in this task — read-only is enough.

## Done When

- `AppState` fetches `GET /tasks` on each poll cycle.
- The menu popover shows the active doing task and ready/backlog counts.
- The section collapses when there is no doing task.
- macOS client compiles cleanly.
