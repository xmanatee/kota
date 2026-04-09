---
id: task-workflow-run-timeout
title: Add workflow-level run timeout to bound stuck runs
status: done
priority: p2
area: workflow
summary: Steps have per-step timeoutMs, but there is no overall run-level timeout. An agent step that hangs or runs unboundedly can block the runtime indefinitely. Add a runTimeoutMs option to WorkflowDefinitionInput that aborts the active run if it exceeds the limit.
created_at: 2026-03-20
updated_at: 2026-03-20
---

## Problem

The workflow runtime runs one workflow at a time. If an agent step hangs or consumes its context budget in an open-ended loop, the runtime is stuck and no other workflow can dispatch. There is no ceiling on how long a single run can take.

The step-level `timeoutMs` partially mitigates this but must be set on every step individually, and agent steps with large context windows can still run for tens of minutes before the SDK gives up.

## Desired Outcome

A `runTimeoutMs` field on `WorkflowDefinitionInput` caps the entire run duration. When exceeded, the run is aborted with status `"interrupted"` (same path as a graceful stop), and the runtime continues normally. The timeout is reflected in `WorkflowRunMetadata`.

## Constraints

- Reuse the existing `AbortController` path that `stop()` already follows.
- Do not add test-only flags or production overrides to support testing.
- Keep the abort path deterministic; no silent swallowing.

## Done When

- `runTimeoutMs` is a typed optional field on `WorkflowDefinitionInput` and `WorkflowDefinition`.
- A run that exceeds `runTimeoutMs` is aborted and logged as `"interrupted"`.
- At least one unit test covers the timeout path.
- Existing tests remain green.
