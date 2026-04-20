---
id: task-add-builder-eval-marker
title: Add builder-eval marker file under data/markers/
status: ready
priority: p3
area: eval-harness
summary: Eval-harness fixture — builder should create data/markers/builder-eval-ok.txt with any content and move this task out of ready/.
created_at: 2026-04-20T00:00:00.000Z
updated_at: 2026-04-20T00:00:00.000Z
---

## Problem

The eval harness needs a tiny deterministic task that proves the builder
workflow can pick up a ready task, edit a single file, and move the task to
a terminal state.

## Desired Outcome

- `data/markers/builder-eval-ok.txt` exists with any non-empty content.
- This task leaves `data/tasks/ready/` (moving to `done/` is the natural
  outcome).

## Constraints

- Only touch `data/markers/` and the task state. No other repo changes.
- Do not commit from the agent step; the workflow's commit step handles
  committing.

## Done When

- `data/markers/builder-eval-ok.txt` exists.
- This task file is no longer under `data/tasks/ready/`.
