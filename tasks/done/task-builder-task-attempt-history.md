---
id: task-builder-task-attempt-history
title: Surface previously-attempted tasks in BuilderContext
status: done
priority: p2
area: workflow
summary: When a builder run fails or leaves a task incomplete, the next builder pick can unknowingly choose the same task again. Surfacing attempt history in BuilderContext lets the agent avoid re-picking consistently failing tasks and instead surface them as blocked or escalate.
created_at: 2026-03-20
updated_at: 2026-03-20T06:20:00Z
---

## Problem

The builder picks tasks from `tasks/ready/` without knowing if a task was previously attempted and failed or stalled. This can lead to repeated failed attempts on the same task, consuming cost without progress. There is no mechanism in BuilderContext to signal that a task was recently touched.

## Desired Outcome

- `BuilderContext` gains a `recentlyAttemptedTaskIds: string[]` field.
- The field is populated by scanning recent builder run outputs or commit messages for task slug references.
- The builder prompt references this field to deprioritize or skip tasks that have been recently attempted without success.
- Alternatively, the builder may choose to move a repeatedly-failing task to `blocked/` with a note.

## Constraints

- Do not introduce a separate attempt-tracking state file. Derive attempt history from existing run metadata and git log.
- Match task IDs against commit messages (builder commits typically mention the task slug).
- Limit to the last 10 builder runs to keep the signal fresh and the context small.

## Done When

- `BuilderContext` includes `recentlyAttemptedTaskIds`.
- `gatherBuilderContext` populates it by scanning recent builder run commit messages or metadata.
- The builder prompt uses this field to inform task selection.
- Tests verify the field is populated correctly from mock run history.
