---
id: task-workflow-input-schema-feedback
title: Surface workflow input schema validation errors as actionable CLI and web UI messages
status: done
priority: p3
area: operator-ux
summary: When a workflow trigger payload fails inputSchema validation the error is a raw JSON Schema violation string. Operators see no guidance on what the schema expects, making misconfigured webhook and CLI triggers hard to debug.
created_at: 2026-04-01T09:44:18Z
updated_at: 2026-04-02T01:06:00Z
---

## Problem

Workflows can declare an `inputSchema` that validates trigger payloads before a run starts. When the payload is invalid, the validation error (`src/core/workflow/payload-validator.ts`) produces a machine-readable string like `payload.count: expected number, got string`. This message is surfaced as-is in:

- The CLI `kota workflow trigger` response
- The webhook `400` response body
- The web UI trigger panel

The raw schema path notation is accurate but unhelpful for operators who did not write the workflow. There is no way to ask "what fields does this workflow expect?" without reading the workflow source file.

## Desired Outcome

Two improvements:

1. **Schema preview**: `kota workflow definitions` and the web UI workflow list show the `inputSchema` fields inline when present, so operators know what inputs a workflow accepts before triggering it.

2. **Richer error messages**: When validation fails, the error message includes the expected type and, if the schema has a `description` field on the failing property, surfaces it. Example: `payload.count (number, required): expected number, got string`.

## Constraints

- `src/core/workflow/payload-validator.ts` owns the validation logic; error format improvements stay there.
- Schema display in CLI uses the existing `kota workflow definitions` output format; add a compact `inputs:` section only when `inputSchema` is defined.
- Web UI schema display reads from the existing definitions API; no new endpoint needed.
- Do not change the JSON Schema structure or validation rules, only presentation.

## Done When

- `kota workflow definitions` lists input field names and types when a workflow declares `inputSchema`.
- Validation error messages include the property description when present in the schema.
- Web UI definitions panel shows a compact field list for workflows with `inputSchema`.
- Existing payload-validator tests pass; add a test for description-enriched error messages.
