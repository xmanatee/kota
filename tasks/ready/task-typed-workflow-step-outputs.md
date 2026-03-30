---
id: task-typed-workflow-step-outputs
title: Add TypeScript generic types for workflow step outputs
status: ready
priority: p3
area: runtime
summary: Workflow step outputs are currently typed as unknown in stepOutputs. As step chaining grows — builder's inspect-ready-queue feeding the build step's when predicate, for example — silent type mismatches cause subtle bugs. Adding a typed generic to step definitions would catch these at definition time.
created_at: 2026-03-30T15:00:00Z
updated_at: 2026-03-30T16:58:10Z
---

## Problem

`WorkflowStep.run()` returns `unknown` and consumers access `stepOutputs` as
`Record<string, unknown>`. Step `when` predicates and `run` functions cast or
narrow these values at runtime with no compile-time safety.

The builder workflow demonstrates the current pattern:
```ts
const inspectOutput = stepOutputs["inspect-ready-queue"];
// Cast and manually check shape before use
```

As more workflows chain steps and contributed extensions add their own
step chaining, the lack of type information makes it easy to break a
downstream step silently when an upstream step changes its output shape.

## Desired Outcome

A TypeScript generic on `WorkflowStep` (or a typed step factory pattern)
allows step output shapes to be declared at definition time. The `when`
predicate and downstream `stepOutputs` access get inferred types, so
type mismatches are caught by the compiler rather than at runtime.

The solution should be pragmatic — it should not require annotating every
existing step, and the runtime representation can stay `Record<string, unknown>`.
The goal is compile-time safety at definition sites, not a runtime schema layer.

## Constraints

- Keep the runtime `stepOutputs` type as `Record<string, unknown>` — do not
  change the data shape.
- Do not require a full schema/validation layer (Zod, etc.) unless it fits
  naturally.
- Existing workflow definitions should continue to work unchanged (untyped
  steps remain valid).
- The solution should work for both built-in and contributed (extension)
  workflow definitions.

## Done When

- A typed step definition form exists and is usable for new workflows.
- At least one existing workflow (e.g., builder) adopts the typed form as
  a reference example.
- No existing tests break.
- `src/workflow/AGENTS.md` documents the typed step pattern.
