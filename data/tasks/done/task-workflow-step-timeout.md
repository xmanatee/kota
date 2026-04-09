---
id: task-workflow-step-timeout
title: Add per-step timeout to workflow step definitions
status: done
priority: p2
area: runtime
summary: A workflow step that runs a hung agent can block a run indefinitely. There is no per-step timeout, so a single stuck step can tie up the autonomous loop forever with no observable failure.
created_at: 2026-03-30T17:10:57Z
updated_at: 2026-03-30T17:44:28Z
---

## Problem

`WorkflowStep.run()` has no timeout. If an agent step enters an infinite
loop, hangs waiting on a stalled tool, or encounters a deadlock, the workflow
run never completes and never fails. The daemon keeps the run in `active`
state, and the autonomous loop is effectively frozen.

Operators have no way to configure a maximum step duration, and the runtime
offers no self-correction mechanism. At current idle-trigger frequency (30s),
a single stuck run occupies the active run slot indefinitely.

## Desired Outcome

`WorkflowStep` accepts an optional `timeoutMs` field. When set, the runtime
wraps the step execution in a deadline. If the step does not complete within
the deadline, the run fails with a descriptive timeout error and the normal
failure path (run marked failed, failure event emitted, alert notification
sent) executes as usual.

A reasonable default timeout (e.g., 30 minutes) should apply to agent steps
even when `timeoutMs` is not specified, so that a stuck step does not require
explicit configuration to eventually resolve.

## Constraints

- Do not cancel step work silently — a timeout must produce a clear failure
  with a log entry, a failed run record, and the normal `workflow.failure.alert`
  event so operators are notified.
- The default timeout should be generous enough to not interrupt legitimate
  long-running agent steps (e.g., a large build run). 30 minutes is a
  reasonable starting point for discussion.
- The timeout mechanism must not introduce a global delay when steps complete
  normally — it should only activate on breach.
- Apply the timeout in the workflow executor, not inside individual step `run`
  functions, so steps do not need to manage their own deadlines.
- Document the field and the default in `src/workflows/AGENTS.md`.

## Done When

- `WorkflowStep` type has an optional `timeoutMs` field.
- The workflow executor enforces the deadline and fails the run on breach.
- A default timeout applies to steps that do not specify one.
- Timeout failures emit `workflow.failure.alert` and produce a failed run record.
- At least one built-in workflow step uses `timeoutMs` as a reference example.
- `src/workflows/AGENTS.md` documents the field and the default behavior.
