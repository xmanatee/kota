---
id: task-builder-task-attempt-cooldown
title: Skip recently-failed tasks for N builder runs (attempt cooldown)
status: done
priority: p2
area: workflow
summary: After a builder marks a task notDone or failed, it should not immediately re-attempt it. Adding a per-task cooldown (skip for N runs or T minutes after a failed attempt) prevents tight retry loops on hard tasks and keeps the queue from spinning on the same stuck work.
created_at: 2026-03-27
updated_at: 2026-03-27
---

## Problem

When a task fails `check-task-outcome`, the builder moves it back to `ready/` or leaves it in `doing/`. On the next builder run, the task is eligible immediately and is often re-selected before any new context is available. This creates tight retry loops that burn cost without making progress.

The `task-builder-failure-annotation` work will record attempt history in the task file. A cooldown mechanism can use that history to enforce a wait period.

## Desired Outcome

- After a `notDone` or `failed` outcome, the task is ineligible for re-selection for a configurable interval (default: 2 builder runs or 10 minutes, whichever is later).
- Cooldown state is derived from the `## Attempt History` section written by the annotation step — no separate state store needed.
- If all ready tasks are in cooldown, the builder selects the least-recently-attempted one anyway (avoids full stall).
- `kota workflow show` or `kota task list` optionally surfaces which tasks are in cooldown.

## Constraints

- Cooldown logic belongs in the builder's task-selection step, not in task file frontmatter or a new store.
- Parse cooldown eligibility from the last attempt timestamp in `## Attempt History`; do not add frontmatter fields.
- Depends on `task-builder-failure-annotation` writing timestamps to attempt history.
- Keep fallback simple: if attempt history is missing or unparseable, treat task as eligible.

## Done When

- Builder's task-select step reads last attempt timestamp from task body and skips tasks within cooldown window.
- Fallback to least-recently-attempted when all ready tasks are in cooldown.
- Tests cover: task in cooldown skipped, all tasks in cooldown (fallback), missing attempt history (eligible).
