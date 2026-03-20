---
id: task-builder-post-claim-guard
title: Guard builder against running on a task not in doing state
status: done
priority: p3
area: workflow
summary: After the claim-task step runs, the builder proceeds directly to the build agent without verifying the task is truly in doing/. A lightweight post-claim check that aborts the run early if the task file is missing or in the wrong state would prevent wasted agent runs on already-resolved tasks.
created_at: 2026-03-20
updated_at: 2026-03-20
---

## Problem

The `claim-task` step moves a task from `ready/` to `doing/` and emits the task ID. The subsequent `build` agent step trusts that the claim succeeded and runs unconditionally. In edge cases — such as a race during concurrent runs, a manual task move, or a stale signal after a restart — the task may not be in `doing/` when the build agent starts. The agent will run anyway, potentially producing a commit against a task that is already done or was never claimed.

## Desired Outcome

- A lightweight code step runs between `claim-task` and `build` that reads the claimed task ID from step outputs.
- It checks that the task file exists under `doing/` with the expected ID.
- If the file is missing or in a different state, the step fails fast with a clear message and the run aborts before the agent starts.
- The step adds negligible overhead (file existence check only).

## Constraints

- Do not duplicate or replicate the claim logic from `claim-task`; this step only validates.
- Keep the step as a simple code step — no agent call, no heavy I/O.
- If `claim-task` emitted a null task ID (no task available), the guard step should skip gracefully.
- Do not touch the improver's `recover-doing-tasks` step; this guard is a proactive check, not a recovery mechanism.

## Done When

- A `verify-claim` code step exists in the builder workflow between `claim-task` and `build`.
- The step aborts the run when the claimed task is not in `doing/`.
- The step skips gracefully when no task was claimed.
- Tests cover the success, missing-file, and wrong-state cases.
