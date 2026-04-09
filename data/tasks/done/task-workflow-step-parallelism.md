---
id: task-workflow-step-parallelism
title: Support parallel step execution within a workflow run
status: done
priority: p3
area: workflow
summary: Workflow steps execute sequentially today. Steps that are logically independent (e.g., parallel gather-context sub-queries) cannot run concurrently. Adding a `parallel` step group type would allow independent steps to overlap and reduce total run time for multi-step workflows.
created_at: 2026-03-20
updated_at: 2026-03-27T06:55:00Z
---

## Problem

All steps in a workflow run execute sequentially. When two or more steps are logically independent — for example, fetching recent commits and fetching run history in a gather-context step — they must still wait for each other. This adds unnecessary latency to workflows with multiple code steps that do not depend on each other's output.

## Desired Outcome

- Workflow definitions can group independent steps into a parallel block.
- Steps within the block execute concurrently; the block completes when all parallel steps finish.
- If any parallel step fails and does not have `continueOnFailure: true`, the block fails and the run aborts (same semantics as sequential failure).
- Individual step outputs from a parallel block are keyed by step ID in `stepOutputs`, same as today.
- `kota workflow show` renders parallel steps with a visual indicator.

## Constraints

- Sequential step order must remain the default; parallel blocks are opt-in.
- Do not change the existing step types or their contracts. The parallel block is a structural container, not a new step type.
- Design must integrate cleanly with the `when` predicate system so steps after a parallel block can still reference any step output by ID.
- Limit initial scope to code steps; agent steps inside parallel blocks can come later.

## Done When

- A parallel step container type is defined and validated.
- `run-executor.ts` executes steps within a parallel block concurrently using `Promise.all`.
- Failure semantics match the existing sequential rules.
- `stepOutputs` contains all step results by ID regardless of execution order.
- Tests cover parallel success, partial failure, and `continueOnFailure` interaction.
