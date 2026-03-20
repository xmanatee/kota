---
id: task-explorer-auto-escalate-blocked-tasks
title: Explorer auto-escalates repeatedly-attempted ready tasks to blocked
status: backlog
priority: p2
area: workflow
summary: When the builder repeatedly attempts the same task without committing progress, the explorer should detect this pattern and move the task to blocked with a note, preventing future builder cycles from wasting cost on it.
created_at: 2026-03-20
updated_at: 2026-03-20
---

## Problem

Builder runs can repeatedly pick the same task from `tasks/ready/` and fail or stall without leaving a clear signal. The current system relies on the builder itself to self-escalate a failing task to `blocked/`, but the builder may not detect the pattern across runs. The explorer sees aggregate run history and is better positioned to notice repeat-fail patterns.

## Desired Outcome

- During each explorer run, scan `tasks/ready/` against `recentlyAttemptedTaskIds` derived from recent builder run outputs (which will be available once `task-builder-task-attempt-history` lands).
- If a ready task appears in builder attempt history 3+ times in the last 10 builder runs without a corresponding done commit, move it to `tasks/blocked/` and add a `## Blocker` note citing the repeated-failure pattern.
- The explorer commit message names the escalated task slug(s) so the pattern is visible in git history.

## Constraints

- Only act when the builder attempt history signal is available in `BuilderContext` or derivable from run metadata. Do not implement until `task-builder-task-attempt-history` is done.
- Do not move a task if the last builder run appears to have made progress on it (e.g., partial commit with the task slug).
- Threshold (3 attempts) is a starting point; keep it in a named constant so it is easy to tune.

## Done When

- Explorer detects tasks with 3+ failed builder attempts and moves them to `blocked/` with a written blocker note.
- Tests cover the escalation logic with mock run history.
- A builder that later fixes the blocker condition can move the task back to `ready/`.
