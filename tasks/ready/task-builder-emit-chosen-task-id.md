---
id: task-builder-emit-chosen-task-id
title: Emit chosen task ID from builder build step output
status: ready
priority: p2
area: workflow
summary: The builder picks one task from ready/ but does not record which task it chose in its run metadata or step outputs. The improver must guess from git commits. Emitting the chosen task ID in a step output would let the improver review code changes against the task's Done When criteria and help identify builder regressions.
created_at: 2026-03-20
updated_at: 2026-03-20T07:13:56Z
---

## Problem

After each builder run, the improver has `triggeringRun` (run metadata) and `changedFiles` (files modified), but no structured signal for which task was being built. The improver infers this from commit messages, which is fragile and loses information when commits are squashed or titles are unclear.

## Desired Outcome

- The builder's `build` step (agent step) emits the chosen task ID as part of its output — or alternatively a pre-build code step reads the ready queue and writes the chosen task to a step output that subsequent steps and the improver can access.
- The improver's `gather-context` reads this value from the triggering run's step outputs and surfaces it as `builtTaskId`.
- The improver prompt uses `builtTaskId` to load the task file and check the implementation against its `## Done When` criteria.

## Constraints

- Agent step outputs are unstructured text today. The cleanest approach may be a lightweight code step before `build` that claims one task (moves it to `doing/`) and emits its ID, rather than parsing the agent's text output.
- Do not introduce database tables or complex state machines; a simple step output value is sufficient.
- Claiming a task before the agent step also prevents two concurrent runs from picking the same task.

## Done When

- A step output reliably contains the chosen task ID for each builder run.
- The improver's `gather-context` includes `builtTaskId` from the triggering run when available.
- The improver prompt references `builtTaskId` and uses it to load and check the task file.
- Tests cover the claim-and-emit step and the improver gather-context change.
