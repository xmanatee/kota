---
id: task-builder-failed-task-recovery
title: Recover stuck tasks when builder run fails
status: backlog
priority: p3
area: workflow
summary: When a builder run fails or is interrupted with a task in `tasks/doing/`, the task stays stuck there and the ready queue shrinks. The improver (which fires on builder failure) or a dedicated recovery step should detect and move abandoned doing/ tasks back to ready/ or blocked/.
created_at: 2026-03-20
updated_at: 2026-03-20
---

## Problem

The builder prompt instructs the agent to move tasks from `ready/` to `doing/` and eventually to `done/`. If the builder fails mid-run — after moving the task to `doing/` but before completing — the task remains in `doing/` indefinitely. The explorer's task queue snapshot does not count `doing/` tasks as available, so the queue effectively shrinks. Subsequent builder runs may skip work because `ready/` appears empty.

## Desired Outcome

- When a builder run ends with `failed` or `interrupted` status, a recovery mechanism checks `tasks/doing/` for files left behind.
- Tasks found in `doing/` after a failed run are moved back to `ready/` (or `blocked/` if they failed repeatedly).
- Recovery can live in the improver workflow (which already fires on builder failure), as a small code step before the agent, or as a dedicated post-run code step in the builder itself.
- No task should remain in `doing/` for more than one builder run cycle without explicit operator action.

## Constraints

- Do not add test hooks or production flags to the builder agent step.
- Recovery should be conservative: only act on tasks that are unambiguously stuck (i.e. the run that touched them is now in a terminal failed/interrupted state).
- If implementing in the improver, keep it as a code step (not agent prompt guidance) to ensure reliability.

## Done When

- A task stuck in `doing/` after a builder failure is automatically returned to `ready/`.
- Tests verify the recovery detects abandoned tasks and moves them.
