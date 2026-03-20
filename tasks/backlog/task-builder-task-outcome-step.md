---
id: task-builder-task-outcome-step
title: Add post-build outcome step to verify task completion
status: backlog
priority: p3
area: workflow
summary: After the builder's build agent step finishes, there is no explicit check that the claimed task was actually moved to done/. Adding a code step that verifies the task file state and emits an outcome record would close the feedback loop and improve recovery visibility.
created_at: 2026-03-20
updated_at: 2026-03-20
---

## Problem

The builder claims a task via `claim-task` (which moves it to `doing/`), then runs the build agent. If the agent succeeds but forgets to move the task to `done/`, or if the run is aborted mid-flight, the task silently stays in `doing/`. The improver's `recover-doing-tasks` step eventually cleans this up, but there is no per-run signal about whether a task was successfully completed.

## Desired Outcome

- A `check-task-outcome` code step runs after the `build` step (regardless of build outcome via `continueOnFailure`).
- It reads the claimed task ID from `stepOutputs["claim-task"]` and checks whether the task file moved to `done/`.
- It emits an outcome object: `{ taskId, resolved: boolean, finalState: "done" | "doing" | "ready" | "missing" }`.
- This outcome is stored in the run's step outputs and visible in `kota workflow show`.
- The per-run outcome makes it easy to audit which builder runs actually completed their task vs. left it stalled.

## Constraints

- Depends on `continueOnFailure` being implemented (task-workflow-step-failure-strategy) so this step runs even when build fails.
- Do not duplicate the recovery logic from the improver's `recover-doing-tasks`; this step only observes and reports, it does not move files.
- Keep the step lightweight — file existence checks only, no heavy I/O.

## Done When

- A `check-task-outcome` step exists in the builder workflow after `build`.
- It emits a structured outcome with the task's final state.
- The step runs even when the build step fails (requires continueOnFailure).
- `kota workflow show` displays the outcome for builder runs.
- Tests cover the success, failure, and partial-completion cases.
