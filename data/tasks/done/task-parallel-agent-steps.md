---
id: task-parallel-agent-steps
title: Allow agent steps inside parallel workflow step groups
status: done
priority: p2
area: runtime
summary: Parallel step groups currently only accept code steps. Allowing agent steps in parallel groups would let workflows run multiple autonomous agents concurrently — for example, running separate research and implementation agents side by side.
created_at: 2026-04-01T01:53:23Z
updated_at: 2026-04-01T03:40:00Z
---

## Problem

`WorkflowParallelGroup` explicitly restricts its members to code steps. The source
comment reads: "Agent steps are not supported in parallel groups." The done task
`task-workflow-step-parallelism` intentionally deferred this: "Limit initial scope
to code steps; agent steps inside parallel blocks can come later."

Operators who want to run two or more agent tasks simultaneously must either use
separate workflows triggered by events (loose coupling, hard to reason about) or
serialize the work into sequential agent steps (wastes wall-clock time). There is
no way to declare "run agent A and agent B concurrently, then continue".

## Desired Outcome

`WorkflowParallelGroupInput` accepts agent steps as members alongside code steps.
The runtime dispatches each agent step in the group concurrently, waits for all to
finish, and aggregates results before the workflow continues. Per-step `timeoutMs`
applies to each agent individually; a failure in any member step marks the group
as failed unless `continueOnFailure` is set.

The change must respect the existing `maxAgentRuns` concurrency ceiling: if the
ceiling would be exceeded, queued parallel agent slots should wait rather than
start immediately.

## Constraints

- Agent steps inside a parallel group follow the same per-step retry and timeout
  rules as sequential agent steps.
- The `maxAgentRuns` limit applies globally across parallel group members and
  sequential steps; do not bypass it.
- Run store step records must faithfully capture each parallel agent step result
  (started, completed, cost, duration) so the web UI run detail view can display them.
- Validation must accept `type: "agent"` members inside `WorkflowParallelGroupInput`
  and reject unsupported types (emit, restart, trigger) with a clear error.
- Backward compatibility: parallel groups with only code steps must continue to work
  unchanged.

## Done When

- `WorkflowParallelGroupInput` accepts `WorkflowAgentStepInput` members.
- The parallel executor dispatches agent steps concurrently using the same pattern
  as `step-executor-parallel.ts` for code steps.
- `maxAgentRuns` ceiling is honored; excess parallel agent slots wait.
- Per-step results (status, cost, duration) are recorded for all parallel agent members.
- Validation rejects disallowed step types inside parallel groups with a clear message.
- Unit tests cover: all agents succeed, one agent fails, timeout applies per-agent,
  `maxAgentRuns` back-pressure.
