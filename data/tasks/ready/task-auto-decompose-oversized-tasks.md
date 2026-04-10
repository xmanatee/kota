---
id: task-auto-decompose-oversized-tasks
title: "Automate task decomposition when builder times out on scope"
status: ready
priority: p2
area: capability
summary: "When a builder run fails due to timeout on an oversized task, no workflow currently decomposes it — the task sits blocked until a human or explorer notices. Adding a decomposition step after repeated builder failure would keep the autonomous loop moving."
created_at: 2026-04-11T00:10:00Z
updated_at: 2026-04-11T00:10:00Z
---

## Problem

The builder workflow has a step timeout (60 minutes). When a task is too broad
for a single run, the builder times out and the run fails. The improver sees
the failure but its job is to improve the autonomy layer's own code, not to
break down product tasks. The explorer creates new tasks when the queue is thin
but does not specifically target failed-and-blocked tasks for decomposition.

This leaves oversized tasks stuck in `blocked/` requiring manual intervention
to split them. The recent `task-move-root-kernel-helpers-into-core` is a live
example: two consecutive builder timeouts before it was manually blocked and
annotated with a decomposition suggestion.

## Desired Outcome

When a builder run fails with a timeout-shaped failure on a specific task, the
system automatically decomposes that task into smaller, builder-scoped subtasks
and moves the original to `blocked/` or `dropped/` with a reference to its
children. The autonomous loop resumes on the subtasks without human
intervention.

## Constraints

- Keep the decomposition logic inside the autonomy module, not in core.
- The mechanism should be a workflow step or a new lightweight workflow
  triggered by builder failure events — not a special case in the builder
  itself.
- Subtasks must follow the standard task format and queue rules.
- Do not decompose on every failure — only when the failure pattern suggests
  scope/size was the problem (timeout, repeated failure on same task).

## Done When

- A builder timeout on an oversized task triggers automatic decomposition.
- The resulting subtasks appear in `ready/` or `backlog/` with proper format.
- The original task is moved to an appropriate terminal or blocked state.
- The mechanism is tested with at least a workflow unit test.
