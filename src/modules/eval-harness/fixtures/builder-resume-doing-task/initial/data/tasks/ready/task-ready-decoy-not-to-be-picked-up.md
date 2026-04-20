---
id: task-ready-decoy-not-to-be-picked-up
title: Decoy ready task the builder must not pick up
status: ready
priority: p3
area: eval-harness
summary: Eval-harness fixture decoy — a task already in doing/ must be finished first. This decoy stays in ready/.
created_at: 2026-04-20T00:00:00.000Z
updated_at: 2026-04-20T00:00:00.000Z
---

## Problem

This task exists only as a distractor for the
`builder-resume-doing-task` eval-harness fixture. A separate task is
already in `data/tasks/doing/` and the builder prompt requires finishing
that one first. Picking up this decoy instead would violate the
resume-doing-first discipline and should surface as a fixture failure.

## Desired Outcome

- This task file remains at `data/tasks/ready/task-ready-decoy-not-to-be-picked-up.md`.
- No marker or artifact associated with this task is produced.

## Constraints

- Do not modify, move, or complete this task during the fixture run.

## Done When

- The fixture run finishes without this task being moved out of `ready/`.
