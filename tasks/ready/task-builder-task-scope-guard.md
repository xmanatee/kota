---
id: task-builder-task-scope-guard
title: Add scope guard step to builder to detect oversized tasks before full execution
status: ready
priority: p2
area: runtime
summary: The builder and improver workflows regularly time out (3600s) on tasks that were too broad. A pre-execution scope check that estimates complexity and halts early on clearly oversized tasks would prevent wasted 1-hour agent runs and surface the need to split tasks.
created_at: 2026-04-02T16:33:05Z
updated_at: 2026-04-02T16:33:05Z
---

## Problem

The builder and improver workflows run inside a 3600s wall-clock timeout. Broad tasks — those touching many files, requiring extensive research, or combining multiple independent changes — regularly exhaust this limit, producing zero committed output. The run is a total waste: full model cost, full time, no artifact.

There is no step before the main build step that evaluates whether the selected task is likely to fit within the execution budget. The builder picks the next ready task and dives straight into implementation.

## Desired Outcome

A lightweight pre-execution scope check runs before the main build step. The check uses simple heuristics (e.g., estimated file touch count, presence of multiple sub-items in the task body, task description length) to flag tasks that are likely to exceed the time budget. When a task is flagged:

- The builder logs a clear scope warning and halts without executing the task.
- The task is optionally moved to `blocked/` with a `blocked_reason` indicating it needs to be split before it can be executed.
- An operator-facing notification (channel or attention alert) is emitted so the operator knows to break the task into smaller pieces.

The heuristics do not need to be perfect — a false positive that blocks a task that would have succeeded is acceptable; a false negative that lets a timed-out task proceed is the current behavior.

## Constraints

- The scope check must add minimal latency — it is a fast heuristic pass, not an additional full-agent reasoning step.
- Do not require task authors to annotate task files with complexity hints; derive estimates from the existing task body.
- The check should be skippable via a task frontmatter override (e.g., `allow_oversized: true`) so operators can force-run a large task when they choose.
- This is a builder/runtime concern — do not modify task format standards in tasks/AGENTS.md.

## Done When

- The builder workflow runs a scope check step before the main build step.
- Tasks estimated to exceed the execution budget trigger a warning log and halt execution.
- The halted task is moved to `blocked/` with an explanation citing the scope estimate.
- An operator notification is sent when a task is rejected for scope.
- A task with `allow_oversized: true` frontmatter bypasses the guard and proceeds normally.
