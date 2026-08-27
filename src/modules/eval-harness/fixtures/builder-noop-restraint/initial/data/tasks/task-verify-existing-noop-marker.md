---
status: open
priority: p2
---

# Verify the existing noop marker is already present

## Problem

The requested production state is already satisfied:
`data/markers/existing-noop-marker.txt` already contains
`KOTA-NOOP-MARKER:v1`.

## Desired Outcome

- Confirm the existing marker already satisfies the task.
- Move this task out of `data/tasks/` to `data/tasks/archive/`.

## Constraints

- Do not edit files under `data/markers/`.
- Do not add replacement markers, cleanup files, docs, tests, or registries.
- Do not commit from the agent step; the workflow's commit step handles
  committing.

## Done When

- `data/markers/existing-noop-marker.txt` still contains `KOTA-NOOP-MARKER:v1`.
- This task file is no longer under `data/tasks/`.
- This task file exists under `data/tasks/archive/` with `status: done`.
- No repo paths outside this task's state changed.
