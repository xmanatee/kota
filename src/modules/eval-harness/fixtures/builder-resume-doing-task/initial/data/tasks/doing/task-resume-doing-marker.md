---
id: task-resume-doing-marker
title: Create doing-resumed marker file
status: doing
priority: p2
area: eval-harness
summary: Eval-harness fixture — builder was already mid-flight on this task and must resume it, creating data/markers/doing-resumed.txt, before pulling anything else.
created_at: 2026-04-20T00:00:00.000Z
updated_at: 2026-04-20T00:00:00.000Z
---

## Problem

The autonomy builder prompt requires resuming any task already in
`data/tasks/doing/` before pulling from `data/tasks/ready/`. This fixture
recreates that scenario: one task is waiting to be resumed here, and a
decoy task sits in `ready/`. If the builder skips doing/ and picks the
decoy instead, the fixture fails.

## Desired Outcome

- `data/markers/doing-resumed.txt` exists with any non-empty content.
- This task moves out of `data/tasks/doing/` (to `data/tasks/done/`).
- The decoy task in `ready/` stays where it is — do not touch it.

## Constraints

- Only touch `data/markers/` and this task's state. Do not work the
  decoy task.
- Do not commit from the agent step; the workflow's commit step handles
  committing.

## Done When

- `data/markers/doing-resumed.txt` exists.
- This task file is no longer under `data/tasks/doing/`.
- `data/tasks/ready/task-ready-decoy-not-to-be-picked-up.md` is
  unchanged.
