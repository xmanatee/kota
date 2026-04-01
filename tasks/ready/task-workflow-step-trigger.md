---
id: task-workflow-step-trigger
title: Add trigger step type to workflow definitions for workflow composition
status: ready
priority: p3
area: runtime
summary: Workflow steps can only run agent prompts or inline code. There is no step type that directly queues another workflow. A trigger step would let workflow authors compose multi-workflow pipelines without writing custom code steps or relying on bus event timing.
created_at: 2026-03-31T17:30:00Z
updated_at: 2026-04-01T01:53:23Z
---

## Problem

Operators who want one workflow to kick off another must write a `code` step that calls
`runtime.triggerWorkflow(name, payload)` directly, leaking runtime internals into workflow
definitions. Alternatively, they use `workflow.completed` event triggers, but this requires
the triggering and triggered workflows to be loosely coupled through the bus — there is no
declarative "run workflow B after step 3 of workflow A".

Without a first-class trigger step, workflow composition is brittle and hard to read.

## Desired Outcome

A new `trigger` step type in `WorkflowStepInput`:

```ts
{
  type: "trigger",
  id: "notify-after-build",
  workflow: "notification-workflow",
  payload: { source: "builder", taskId: "{{trigger.payload.taskId}}" },
  waitFor: "queued" | "completed"   // default: "queued"
}
```

- `workflow`: name of the workflow to queue.
- `payload`: optional static or template-interpolated payload passed to the triggered run.
- `waitFor: "queued"` (default): step completes as soon as the run is accepted into the queue.
- `waitFor: "completed"`: step blocks until the triggered run finishes (success or failure).

The step output is `{ runId: string, status: "queued" | "completed" | "failed" }`.

Simple template interpolation (e.g., `{{trigger.payload.field}}`) is sufficient for payload;
full expression evaluation is out of scope.

## Constraints

- The trigger step must not cause the self-trigger loop guard to be bypassed; a workflow
  cannot trigger itself via a trigger step.
- `waitFor: "completed"` must respect the step-level `timeoutMs` to avoid infinite blocking.
- Follow the existing step type pattern in `src/workflow/types.ts` and `src/workflow/step-executor.ts`.
- Validate the referenced workflow name at definition load time; warn (not error) if the
  workflow is not yet registered (it may be contributed by an extension loaded later).
- Keep the implementation in the workflow executor layer; do not modify core agent session logic.

## Done When

- `WorkflowStepInput` accepts a `type: "trigger"` variant with `workflow`, `payload`, and `waitFor` fields.
- Executing a trigger step queues the named workflow with the provided payload.
- `waitFor: "completed"` blocks until the triggered run finishes (or times out).
- A trigger step that references a nonexistent workflow fails the step with a clear error.
- Unit tests cover `waitFor: "queued"` and `waitFor: "completed"` paths.
- Workflow validation rejects self-referential trigger steps.
