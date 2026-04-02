---
id: task-builder-task-prereq-check
title: Builder reads blocked task context before selecting a task
status: backlog
priority: p3
area: runtime
summary: The builder picks the next task from ready/ without checking whether the task references a blocked predecessor. Adding a prereq-awareness step reduces wasted runs where the builder picks a task that implicitly depends on incomplete earlier work.
created_at: 2026-04-02T10:41:13Z
updated_at: 2026-04-02T10:41:13Z
---

## Problem

The builder agent selects a task from `tasks/ready/` and starts work. It has no structured signal about whether a task references prerequisites that are still in `tasks/blocked/` or `tasks/doing/`. When a chosen task has a hard implicit dependency on unfinished work, the builder either produces incomplete output or makes changes that conflict with the in-progress work — requiring a follow-up run to undo or revise.

There is no field in the task format for declaring hard dependencies, and the builder prompt does not instruct the agent to scan `blocked/` or `doing/` before committing to a task.

## Desired Outcome

The builder prompt includes guidance to:

1. Before selecting a task, briefly scan `tasks/blocked/` and `tasks/doing/` for any tasks whose title or summary overlaps with the candidate.
2. Skip a candidate task if a clearly related task is currently in `blocked/` or `doing/`, and note the reason in the run summary.
3. Prefer tasks with no apparent cross-task dependency when multiple ready tasks are available.

This does not require a new metadata field — it is a prompt-level heuristic, not a hard structural constraint.

## Constraints

- Changes are confined to the builder agent prompt (`src/workflows/builder/prompt.md`). No workflow or runtime changes.
- The check should be a lightweight heuristic, not an exhaustive dependency graph traversal. One scan of `blocked/` and `doing/` filenames and summaries is sufficient.
- Do not add a `dependsOn` field to the task format or task schema — leave structural dependency modeling to a future task if validated.
- The builder must still complete runs promptly; the prereq check must not add unnecessary delay.

## Done When

- Builder prompt instructs the agent to scan `blocked/` and `doing/` before committing to a task.
- When a related blocked/doing task is found, the builder picks a different ready task (or exits cleanly if no alternative is available).
- A test scenario in the builder workflow test confirms the heuristic is exercised (can be a simple unit test on prompt sections or a workflow harness test).
