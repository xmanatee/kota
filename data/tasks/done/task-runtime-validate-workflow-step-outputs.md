---
id: task-runtime-validate-workflow-step-outputs
title: Runtime-validate workflow step outputs
status: done
priority: p1
area: core
summary: Replace compile-time-only typedCodeStep casts with runtime-validated output contracts for downstream-consumed workflow outputs, especially code steps and persisted resume paths.
created_at: 2026-04-28T22:24:00.000Z
updated_at: 2026-04-29T04:23:57.970Z
---

## Problem

`typedCodeStep<T>` improves author ergonomics, but its `output(ctx)` accessor
is only `context.stepOutputs[def.id] as T`. After persistence, resume,
parallel execution, branch/foreach aggregation, or manual fixture loading, that
cast does not prove the runtime value still matches the expected shape.

Agent steps can use `outputFormat: "json"` plus `outputSchema`, but code step
outputs that feed downstream decisions do not have an equivalent enforced
runtime contract.

## Desired Outcome

Workflow step outputs that are consumed downstream have runtime-validated
contracts:

- Code steps can declare an output schema or typed decoder.
- `typedCodeStep` either requires a runtime validator for downstream use or is
  replaced by a safer helper.
- `when` predicates and downstream step inputs read through validated accessors.
- Persisted/resumed step outputs are revalidated before use when the workflow
  depends on their shape.
- Validation failures are classified as protocol errors with useful run
  artifacts.

## Constraints

- Do not require schemas for every throwaway output. Require validation when a
  step exposes output to an agent or another step reads structured fields from
  it.
- Preserve simple workflows; do not make one-off scalar code steps verbose.
- Coordinate with existing `task-workflow-output-schema` history and avoid
  duplicating completed agent-output work.
- Keep validation deterministic and restart-safe.

## Done When

- A workflow author can declare a runtime output contract for code steps.
- Downstream accessors fail loudly when persisted output does not match the
  declared contract.
- Existing autonomy workflows with structured code-step outputs are migrated
  or explicitly marked as scalar/unstructured.
- Tests cover normal execution, bad output, and resumed persisted bad output.

## Source / Intent

Investigation evidence:

- `src/core/workflow/types.ts` implements `typedCodeStep<T>` as a cast.
- `src/core/workflow/AGENTS.md` acknowledges that runtime representation is
  unchanged and `stepOutputs` remains `Record<string, unknown>`.
- LangGraph durable execution guidance emphasizes deterministic replay,
  idempotent side effects, and checkpointed state consistency.
- CrewAI Flows documentation emphasizes structured state management when type
  safety and validation matter.

## Initiative

Workflow reliability: make persisted workflow state and downstream step
contracts robust under restart, replay, and future refactors.

## Acceptance Evidence

- Unit tests showing a bad persisted output fails before a downstream step can
  consume it.
- At least one autonomy workflow migrated to the new validated output pattern.
- Run artifact example showing the protocol error message for schema mismatch.

