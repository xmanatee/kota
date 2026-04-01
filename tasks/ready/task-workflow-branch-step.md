---
id: task-workflow-branch-step
title: Add branch step type for conditional workflow routing
status: ready
priority: p2
area: runtime
summary: Workflows currently express conditional logic by attaching a `when` predicate to each step independently. There is no if/else construct that selects between two sequences. A branch step would enable cleaner conditional routing without requiring duplicate `when` logic on paired steps.
created_at: 2026-04-01T06:25:00Z
updated_at: 2026-04-01T06:25:00Z
---

## Problem

When a workflow needs to take different paths depending on a condition — for example, run a
notification step only on weekdays, or choose between a fast path and a thorough path based on
recent run history — the author must attach mirrored `when` predicates to each branch.
This pattern duplicates the condition, is error-prone (missing or stale predicates leave both
branches running), and makes the intent harder to read.

A dedicated `branch` step type would make conditional routing explicit and eliminate the need
for mirrored predicates.

## Desired Outcome

A new `branch` step type in `WorkflowStep`:

```typescript
{
  id: "my-branch",
  type: "branch",
  when?: WorkflowPredicate,       // optional outer skip guard
  condition: WorkflowPredicate,   // the branch condition
  ifTrue: WorkflowStep[],         // steps to run when condition returns true
  ifFalse?: WorkflowStep[],       // optional steps to run when condition returns false
}
```

The executor evaluates `condition`, then runs `ifTrue` or `ifFalse` steps in order.
Steps inside `ifTrue`/`ifFalse` support all existing step types (agent, code, emit, trigger)
and their `when` predicates. Nested `branch` steps are also allowed.

Dry-run output (`kota workflow run --dry-run`) should indicate the branch structure and show
both arms with their `whenResult` based on empty-context evaluation.

## Constraints

- Only one arm runs per evaluation — there is no parallel execution of both arms.
- `ifFalse` is optional; omitting it is equivalent to `ifFalse: []` (no-op when false).
- Nested branch depth should have a reasonable cap (e.g. 5 levels) to prevent confusion.
- All existing step types and workflow definitions must remain unchanged and unaffected.
- The `WorkflowTestHarness` must be able to mock `condition` predicates to test both paths.

## Done When

- `branch` is a valid step type accepted in `WorkflowStep` and `WorkflowDefinitionInput`.
- The step executor evaluates `condition` and runs the correct arm's steps.
- Dry-run output renders the branch structure and both arms.
- `WorkflowTestHarness` supports mocking branch conditions.
- At least one built-in workflow (or a new test-only workflow) uses a branch step to
  demonstrate the feature and provide a concrete usage reference.
- Unit tests cover the true path, false path, omitted `ifFalse`, and nested branch scenarios.
