---
status: done
---

# Add workflow-level run timeout to bound stuck runs

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
