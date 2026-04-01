---
id: task-workflow-output-schema
title: Add optional outputSchema to workflow definitions for validated outputs
status: backlog
priority: p3
area: runtime
summary: Workflows accept an inputSchema to validate trigger payloads, but have no outputSchema to declare and validate what they produce. An outputSchema would let orchestrating workflows and operators know what a sub-workflow is guaranteed to return.
created_at: 2026-04-01T18:44:59Z
updated_at: 2026-04-01T18:44:59Z
---

## Problem

KOTA workflow definitions already support `inputSchema` to validate trigger payloads before
a run starts. There is no corresponding `outputSchema` to declare what a workflow produces
when it completes.

This creates two practical problems:

1. **Orchestration contracts are implicit.** When a trigger step calls a child workflow with
   `waitFor: "completed"`, the parent has no static description of what `childOutput` will
   contain. Operators must read the child workflow's source to guess the output shape.

2. **Silent shape drift.** If a child workflow's last step changes its return shape, no
   validation catches the mismatch before downstream steps break at runtime.

This is analogous to the `inputSchema` gap that was already addressed — the same pattern
applies to outputs.

## Desired Outcome

`WorkflowDefinitionInput` (and its normalized form) gains an optional `outputSchema` field
accepting a JSON Schema object, consistent with the existing `inputSchema` field.

When `outputSchema` is present and a run completes successfully, the runtime validates the
last step's output against the schema. If validation fails, the run is marked
`completed-with-warnings` and a structured warning is appended to the run record. No hard
failure — the output is still recorded.

The schema is surfaced in `GET /api/workflow/definitions` and `kota workflow list --json`
so tooling and operators can inspect it without reading source.

## Constraints

- Reuse `validatePayloadSchema` from `workflow/payload-validator.ts` — do not introduce a
  new validation library.
- Validation only fires on successful run completion; failed/aborted runs skip it.
- Emit a warning rather than a hard failure to avoid breaking existing runs on schema
  addition.
- No change to the existing `inputSchema` behavior.
- The schema field is optional; workflows without it behave exactly as before.

## Done When

- `WorkflowDefinitionInput.outputSchema` is accepted and passed through validation.
- A completed run with a declared `outputSchema` validates the last step output and emits a
  warning on mismatch.
- `GET /api/workflow/definitions` includes `outputSchema` when present.
- Unit tests cover schema match, schema mismatch (warning path), and no-schema (no-op).
- Type-checking and linting pass.
