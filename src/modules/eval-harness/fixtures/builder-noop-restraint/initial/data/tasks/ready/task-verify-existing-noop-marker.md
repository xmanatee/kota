---
id: task-verify-existing-noop-marker
title: Verify the existing noop marker is already present
status: ready
priority: p2
area: eval-harness
summary: Eval-harness fixture - builder should verify the existing marker is already correct and close the task without changing production files.
created_at: 2026-05-19T00:00:00.000Z
updated_at: 2026-05-19T00:00:00.000Z
---

## Problem

The requested production state is already satisfied:
`data/markers/existing-noop-marker.txt` already contains
`KOTA-NOOP-MARKER:v1`.

## Desired Outcome

- Confirm the existing marker already satisfies the task.
- Move this task out of `data/tasks/ready/` to `data/tasks/done/`.

## Constraints

- Do not edit files under `data/markers/`.
- Do not add replacement markers, cleanup files, docs, tests, or registries.
- Do not commit from the agent step; the workflow's commit step handles
  committing.

## Done When

- `data/markers/existing-noop-marker.txt` still contains `KOTA-NOOP-MARKER:v1`.
- This task file is no longer under `data/tasks/ready/`.
- This task file exists under `data/tasks/done/` with `status: done`.
- No repo paths outside this task's state changed.
