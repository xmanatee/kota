# Workflows

This directory contains built-in workflow definitions and their co-located prompts.

- Each workflow should live in its own subdirectory with code plus markdown prompt assets.
- Keep workflows cohesive and typed in code; keep long-lived guidance in markdown.
- Keep role boundaries sharp.
- `workflow.ts` in each workflow directory is the source of truth for that workflow.
- If a built-in workflow uses a named built-in agent, export that agent from the same `workflow.ts`.
- Built-in workflows are discovered from these directories at runtime and contributed through the workflow extension. Do not add a separate registry for them.

## Self-Trigger Loop Risk

Any workflow with a `workflow.completed` trigger must narrow that trigger so it
cannot match its own completion payload. A self-matching completion trigger
creates an infinite loop that hangs the runtime and the test suite. The
validation layer enforces this at definition load time as a hard error.

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

The timeout is enforced in two places:
- **agent, code, tool, emit, restart, trigger steps**: enforced by `executeWorkflowStep` in `run-executor-step.ts` via a per-step `AbortController` and `Promise.race` timeout guard.
- **branch and foreach group steps**: enforced directly in `run-executor.ts` with the same `AbortController` + `Promise.race` timeout guard; the step-level abort is forwarded to all inner steps.
- **parallel groups**: `WorkflowParallelGroup` does not extend `WorkflowBaseStep` and has no `timeoutMs`; parallel groups are not subject to the per-step timeout.

A step timeout causes run status `"failed"`, not `"interrupted"` — distinguishable from an external abort.

## Unit Testing

Each workflow should have a co-located `workflow.test.ts` that uses `WorkflowTestHarness`
(exported from `kota/testing`) to test `when` predicate and skip/run logic without a running
daemon. Focus on the decisions the workflow makes — which steps run, which skip, and why —
not on the agent step content itself (mock those via `stepMocks`).

See `builder/workflow.test.ts` and `explorer/workflow.test.ts` for representative examples.

If a workflow has no `when` predicates or non-trivial skip logic, a unit test adds little value;
rely on the integration test below instead.

## Workflow Tags

Use workflow-level `tags` for routing and policy instead of hardcoding built-in
workflow names across prompts and runtime logic.

- `autonomous` marks workflows that participate in the autonomous development loop.
- `queue-source` marks workflows whose successful completion can feed the task implementation loop.
- `delivery` marks workflows that implement normalized work.
- `governance` marks workflows that improve or inspect the autonomy layer itself.
- `attention-source` marks workflows whose completion should feed attention-digest style observers.
- `recovery-handler` marks workflows that may be queued first during dirty-worktree recovery.

Add routing tags in the workflow definition itself. Do not spread new workflow
names through other prompts, docs, or registries just to make them discoverable.

## Repair-Loop Checks

Workflow repair-loop checks should use `type: "code"` with `spawnSync` rather than `tool: "shell"`.
The `shell` tool lives in the execution extension and is not guaranteed to be available in every
workflow execution context. `type: "code"` checks run inline in the workflow process and have no
tool-availability dependency.

When migrating a tool out of core into an extension, check whether any repair-loop checks in
`src/workflows/` still reference that tool by name — if so, update them in the same commit.

## Dirty Failure Recovery

If an `autonomous` workflow fails and leaves the repo dirty, the runtime now
treats that as a recovery condition, not as normal queue progression. The
daemon restarts once, queues a single `recovery-handler` workflow on the next
boot, and then pauses dispatch if the same dirty state still cannot be
repaired. Do not reintroduce dirty-worktree bounce loops.

## Integration Test

`autonomous-loop.integration.test.ts` discovers the built-in workflow set from this directory. When adding a new built-in workflow:
- Ensure its trigger and step behavior is safe against the sparse test fixture in that file.
- Confirm the self-trigger loop guard above is satisfied.
