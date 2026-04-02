---
id: task-foreach-step-concurrency
title: Add optional concurrency limit to foreach workflow steps
status: ready
priority: p3
area: runtime
summary: Foreach steps iterate serially over each item. For CPU-light or I/O-bound inner steps (code steps, HTTP calls, non-agent work), serial execution leaves throughput on the table. An optional maxConcurrency field would let operators run foreach iterations in parallel up to a configured cap.
created_at: 2026-04-02T00:34:41Z
updated_at: 2026-04-02T05:47:58Z
---

## Problem

`step-executor-foreach.ts` runs each iteration sequentially (`for (let i = 0; ...)`).
For workflows that fan out over many items — processing a list of files, validating a batch
of records, or enriching a set of results — serial execution can take far longer than
necessary when inner steps are code steps or external calls that do not hold the agent slot.

There is no way to express "run up to 5 iterations concurrently" without restructuring the
workflow into parallel steps with hard-coded items.

## Desired Outcome

`WorkflowForeachStep` gains an optional `maxConcurrency` field (positive integer, default 1 =
current serial behavior). When `maxConcurrency > 1`, the foreach executor processes items in
batches up to that limit using `Promise.allSettled` or a pool pattern. Results are collected
in order; `continueOnFailure` semantics are preserved.

The runtime must not allow `maxConcurrency > 1` when inner steps include agent steps, since
concurrent agent steps would contend for the `agentConcurrency` slot. If such a definition
is loaded, `validateWorkflowDefinitions` returns a clear error.

## Constraints

- Concurrency is gated at the foreach item level, not across separate foreach steps.
- Agent inner steps: `maxConcurrency` > 1 must be rejected at validation time with a clear error.
- Code inner steps only: concurrency is limited to `maxConcurrency`.
- Result ordering in the `foreach` step output follows item index, not completion order.
- Existing foreach behavior (maxConcurrency absent or 1) is identical to today.
- Tests must cover serial (default), parallel, and validation-rejection cases.

## Done When

- `WorkflowForeachStep` accepts an optional `maxConcurrency` field (type: positive integer).
- When `maxConcurrency > 1` and all inner steps are code steps, items execute concurrently
  up to the cap.
- Validation rejects definitions where `maxConcurrency > 1` and any inner step is an agent step.
- Existing foreach tests pass; new tests cover the parallel path.
- `docs/WORKFLOWS.md` or inline JSDoc notes the field.
