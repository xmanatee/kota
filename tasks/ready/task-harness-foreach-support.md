---
id: task-harness-foreach-support
title: Add foreach step support to WorkflowTestHarness
status: ready
priority: p3
area: runtime
summary: WorkflowTestHarness handles code, agent, emit, restart, trigger, tool, parallel, and branch steps but silently falls through foreach steps. Workflows that use foreach cannot be unit-tested with the harness, leaving a gap in the testing surface for a first-class step type.
created_at: 2026-04-02T03:00:00Z
updated_at: 2026-04-02T03:58:38Z
---

## Problem

`src/workflow-testing/index.ts` `executeStep` does not have a case for `step.type === "foreach"`.
A workflow definition that contains a foreach step will reach the final else branch and produce
no output and no step result, making the harness silently incorrect for foreach-containing workflows.

`foreach` is a first-class step type with `items`, `as`, `steps`, and optional `maxConcurrency`
and `continueOnFailure` fields. Tests for workflows that fan out over dynamic lists cannot
be written today without spawning a full daemon.

## Desired Outcome

`WorkflowTestHarness.executeStep` handles foreach steps:

- Evaluates the outer `when` predicate (skip if false).
- Resolves `items` (supports function or static array, using the step context).
- Iterates over each item, binding it to the `as` variable in context (via `stepOutputs` or
  context extension) and executing the inner `steps` array for each iteration.
- Collects per-item results; respects `continueOnFailure`.
- Records a foreach step result with `{ items: itemCount, results: [...] }` output.
- Respects `maxConcurrency` in the same opt-in manner as the `parallel` flag: serial by
  default, concurrent when `maxConcurrency > 1` and the harness `parallel: true` option is set.

## Constraints

- The `as` binding must be injected into the step context so inner code steps can access
  the current item — follow how the runtime does it in `step-executor-foreach.ts`.
- Serial-by-default behavior; opt-in parallelism follows the existing `parallel` harness option.
- No changes to the public `HarnessOptions` or `HarnessRunResult` types.
- Update the `kota/testing` JSDoc in `testing-api.ts` to document foreach support.

## Done When

- A workflow with a foreach step runs correctly in the harness.
- Inner code steps can access the current iteration item via context.
- `continueOnFailure` on foreach steps is respected.
- Tests cover single-item, multi-item, and failure cases.
- Existing harness tests pass unchanged.
