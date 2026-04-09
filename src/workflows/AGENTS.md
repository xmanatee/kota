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

## Built-in Role Split

- `inbox-sorter` owns `data/inbox/` and turns quick captures into normalized
  tasks, concise doc updates, or other durable notes.
- `explorer` owns external discovery and should only shape new roadmap work
  when the local queue is otherwise empty.
- `builder` owns implementation of normalized tasks from `data/tasks/`.
- `improver` owns the autonomy/process layer itself.

## Repair-Loop Checks

Workflow repair-loop checks should use `type: "code"` with `spawnSync` rather than `tool: "shell"`.
The `shell` tool lives in the execution extension and is not guaranteed to be available in every
workflow execution context. `type: "code"` checks run inline in the workflow process and have no
tool-availability dependency.

When migrating a tool out of core into an extension, check whether any repair-loop checks in
`src/workflows/` still reference that tool by name — if so, update them in the same commit.

## Dirty Failure Recovery

If a built-in autonomous workflow (`inbox-sorter`, `explorer`, `builder`, `improver`) fails and leaves the repo
dirty, the runtime now treats that as a recovery condition, not as normal queue progression.
The daemon restarts once, queues a single improver recovery on the next boot, and then pauses
dispatch if the same dirty state still cannot be repaired. Do not reintroduce explorer/improver
bounce loops around dirty-worktree failures.

## Integration Test

`autonomous-loop.integration.test.ts` uses `getBuiltinWorkflowDefinitions()`, so every workflow
registered in `src/workflow/registry.ts` runs in that test. When adding a new built-in workflow:
- Ensure its trigger and step behavior is safe against the sparse test fixture in that file.
- Confirm the self-trigger loop guard above is satisfied.
