---
id: task-per-workflow-cost-cap
title: Add per-workflow run cost cap to workflow definitions
status: done
priority: p3
area: runtime
summary: The global daily budget guard halts all dispatch when the daily limit is hit, but there is no way to cap spend on a single workflow run. A long-running builder or improver run can consume an outsized share before the guard fires.
created_at: 2026-03-30T21:20:00Z
updated_at: 2026-03-30T22:30:00Z
---

## Problem

`BudgetGuard` enforces a single global daily spend cap. There is no mechanism to
declare that, for example, a builder run should not exceed $0.50 regardless of
how many agent steps it takes. A runaway or unexpectedly expensive run can consume
most of the daily budget before the global guard intervenes.

Workflow definitions have no `costLimitUsd` field, and the workflow executor does
not check accumulated run cost against a per-run threshold.

## Desired Outcome

Workflow definitions can declare an optional `costLimitUsd: number` field. When
set, the workflow executor checks accumulated run cost after each step and fails
the run gracefully with a descriptive error message if the limit is exceeded.
The failed run follows the normal failure path: status set to `"failed"`,
`workflow.failure.alert` emitted so the operator is notified.

The global daily `BudgetGuard` is unchanged.

## Constraints

- `costLimitUsd` is optional; existing definitions without it are unaffected.
- Check is performed after each step completes, using the cost already recorded
  in the run record — no new cost-tracking mechanism needed.
- Failure message must clearly identify the cost cap as the cause.
- Unit test: run that exceeds cap fails; run under cap continues.

## Done When

- `WorkflowDefinition` (or equivalent) has an optional `costLimitUsd` field.
- Executor fails the run with a clear message when accumulated cost exceeds the cap.
- `workflow.failure.alert` is emitted on cap-triggered failure.
- At least one unit test covers the cap-exceeded and cap-not-exceeded paths.
- `docs/WORKFLOWS.md` documents the new field.
