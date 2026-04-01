---
id: task-trigger-step-child-output
title: Surface child workflow output in parent trigger step result
status: ready
priority: p2
area: runtime
summary: When a trigger step runs with waitFor completed, the parent run receives only runId and status. The child workflow's final step outputs are not propagated, so parent steps cannot branch or act on the child's result.
created_at: 2026-04-01T18:44:59Z
updated_at: 2026-04-01T18:44:59Z
---

## Problem

A trigger step with `waitFor: "completed"` lets a workflow orchestrate a child workflow and
wait for it to finish. However the parent's step output is currently `{ runId, status }` only —
the child's actual step outputs are discarded by `triggerWorkflowFromStep` in
`runtime-dispatch.ts`, which resolves the promise before reading the child's run results.

This means parent workflows cannot:
- Branch on the child's output (`when: (ctx) => ctx.stepOutputs["child-step"].someField`)
- Pass the child's result into a subsequent agent prompt
- Distinguish a successful child that produced nothing from one that produced a meaningful value

The child run's data is written to disk in its own run directory, so the information is
present and retrievable — it just isn't wired into the parent's step context.

## Desired Outcome

When `waitFor: "completed"`, the trigger step's output includes the child's last step output:

```ts
type TriggerStepOutput = {
  runId: string;
  status: "queued" | "completed" | "failed";
  childOutput?: unknown; // last step output from the completed child run
};
```

Parent workflows can then access `ctx.stepOutputs["trigger-step-id"].childOutput` in
downstream `when` predicates and agent prompts.

When `waitFor: "queued"`, `childOutput` is omitted (the child hasn't run yet).

## Constraints

- Read the child run's result from the existing `WorkflowRunStore` after the bus event fires
  in `runtime-dispatch.ts`. Do not add new disk persistence.
- Only populate `childOutput` for `waitFor: "completed"` paths.
- The `TriggerStepOutput` type in `step-executor-trigger.ts` must be extended to include
  the optional field.
- The existing trigger step tests must continue to pass.
- No new public API surface beyond the extended output type.

## Done When

- A trigger step with `waitFor: "completed"` returns `childOutput` populated from the
  child run's last step output when the child run succeeds.
- Parent workflow `when` predicates and code steps can access `childOutput` without casts.
- Unit tests cover the happy path and the case where `waitFor: "queued"` returns no
  `childOutput`.
- Type-checking and linting pass.
