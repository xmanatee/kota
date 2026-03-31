---
id: task-workflow-conditional-steps
title: Add conditional step execution to workflow definitions
status: backlog
priority: p3
area: runtime
summary: Workflow steps always execute in sequence; there is no way to branch based on a prior step's output or run-time conditions.
created_at: 2026-03-31T14:40:00Z
updated_at: 2026-03-31T14:40:00Z
---

## Problem

Workflow definitions execute steps sequentially or in parallel groups, but offer no conditional branching. If a workflow needs to take different paths based on the output of a previous step — e.g. run a repair step only when a prior check fails, or skip a notification step when no changes were made — the only options today are: encode all logic inside a single agent step, or split into multiple workflows triggered by events.

This pushes branching decisions into agent prompts or event chains, making workflow logic harder to read and maintain.

## Desired Outcome

A `condition` field (or similar mechanism) on `WorkflowBaseStep` that evaluates a boolean expression against prior step output or run context, and skips the step when the condition is false. The condition should be expressible as a JavaScript predicate that receives the run context, consistent with how existing step fields like `timeoutMs` and code step `run` functions work.

Example use case: only commit and alert after an agent step if the step actually produced changes (detectable via git status or step output).

## Constraints

- Must not break existing workflow definitions (opt-in field, skipped steps default to no-op with a clear run record entry).
- Keep the DSL simple — this is not a full workflow engine. Predicate receives context, returns boolean.
- Skipped steps should appear in run history with status `skipped` (not silently absent).
- Parallel group steps may need separate handling or be excluded in the first cut.

## Done When

- `WorkflowBaseStep` has an optional `condition` field accepting a context predicate.
- The step executor skips the step and records `skipped` status when the condition returns false.
- At least one built-in workflow uses the feature as a reference implementation.
- Existing tests pass; new tests cover skip behavior.
