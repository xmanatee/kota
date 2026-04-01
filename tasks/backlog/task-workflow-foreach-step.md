---
id: task-workflow-foreach-step
title: Add foreach step type to the workflow DSL for iterating over lists
status: backlog
priority: p3
area: runtime
summary: The workflow DSL supports sequential, parallel, and branch steps but has no way to iterate over a list of items. A foreach step would run a sequence of inner steps for each item, enabling patterns like processing multiple targets, batching reports, or looping over task IDs.
created_at: 2026-04-01T07:53:00Z
updated_at: 2026-04-01T07:53:00Z
---

## Problem

The current workflow step types — `code`, `agent`, `parallel`, `branch`, `trigger`, `emit`, `restart` — cover sequential and conditional flows but not iteration. A workflow that needs to act on each item in a dynamic list (e.g., emit a status summary for each failing run, check N targets, or fan-out a step for each entry returned by a code step) must either use a parallel step with a fixed structure or embed the iteration logic inside a single code step. Neither is composable: the first is inflexible, the second hides work from the step-level observability model.

## Desired Outcome

A `foreach` step type in the workflow DSL that accepts:
- An `items` resolver (code function or `{{step.output.field}}` template) that returns an array.
- An `as` name for the current item, available in inner step resolvers as a context variable.
- A `steps` array of inner step definitions (code and agent steps; no nested foreach or parallel).

Each item is processed in sequence (not concurrently — use parallel for that). The step succeeds when all items complete; it fails on first inner-step failure unless `continueOnFailure` is set.

Example:
```ts
{
  id: "check-each-target",
  type: "foreach",
  items: (ctx) => getTargets(ctx),
  as: "target",
  steps: [
    {
      id: "check",
      type: "code",
      run: (ctx) => verifyTarget(ctx.foreach.target),
    },
  ],
}
```

## Constraints

- Inner steps may be `code` or `agent` only; `foreach`, `parallel`, `branch`, `trigger`, `emit`, and `restart` are not supported inside a foreach body to avoid deep nesting complexity.
- Iteration is sequential, not parallel — `parallel` covers the concurrent case.
- The foreach step appears in run step records with per-item sub-step entries, consistent with how parallel shows child steps.
- Follow the existing `WorkflowBaseStep` pattern; the foreach step type should appear in `WorkflowStepInput`, `WorkflowStep`, and the executor.
- Update `docs/WORKFLOWS.md` step type reference and add a usage example.
- Add a unit test for the executor covering: empty list (no-op), single item, failure on first item with `continueOnFailure: false`, and `continueOnFailure: true` continuing past a failure.

## Done When

- `WorkflowStepInput` and `WorkflowStep` include the `foreach` type with correct TypeScript types.
- The workflow executor runs inner steps for each item in sequence.
- Per-item sub-step results appear in the run metadata consistent with the parallel step pattern.
- `docs/WORKFLOWS.md` documents the foreach step with a usage example.
- Unit tests cover the executor behavior for the cases listed above.
