# Workflows

This directory contains built-in workflow definitions and their co-located prompts.

- Each workflow should live in its own subdirectory with code plus markdown prompt assets.
- Keep workflows cohesive and typed in code; keep long-lived guidance in markdown.
- Keep role boundaries sharp.

## Self-Trigger Loop Risk

Any workflow with a `workflow.completed` trigger **must** include a `workflow` filter that does not
contain its own name. Omitting the filter (or including the workflow's own name) causes the workflow
to re-trigger after its own completion, creating an infinite loop that hangs the runtime and the
test suite. The validation layer enforces this at definition load time as a hard error.

## Per-Step Timeout

All step types except `parallel` groups have an optional `timeoutMs` field (defined on
`WorkflowBaseStep`). `WorkflowParallelGroup` does not extend `WorkflowBaseStep` and therefore
has no `timeoutMs`; parallel groups run outside `executeWorkflowStep` and are not subject to the
default timeout. When a non-parallel step does not complete within the deadline, the run fails
with a descriptive error and the normal failure path executes — failed run record,
`workflow.failure.alert` emitted, operator notified.

When `timeoutMs` is not specified, `DEFAULT_STEP_TIMEOUT_MS` (30 minutes) applies automatically.
Set a larger value on known long-running agent steps; the builder's `build` step uses 60 minutes
as a reference example.

The timeout is enforced by the workflow executor (`run-executor-step.ts`) via a per-step
`AbortController` and a `Promise.race` fallback for non-abortable code steps. A step timeout
causes run status `"failed"`, not `"interrupted"` — so it is distinguishable from an external abort.

## Integration Test

`autonomous-loop.integration.test.ts` uses `getBuiltinWorkflowDefinitions()`, so every workflow
registered in `src/workflow/registry.ts` runs in that test. When adding a new built-in workflow:
- Ensure its trigger and step behavior is safe against the sparse test fixture in that file.
- Confirm the self-trigger loop guard above is satisfied.
