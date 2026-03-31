---
id: task-workflow-input-schema
title: Add typed input schema to workflow definitions for validated trigger payloads
status: backlog
priority: p3
area: runtime
summary: Workflow triggers that carry payload data (webhooks, event-driven) have no way to declare expected input shape. Agents receive untyped trigger payloads and must defensively parse them. A declarative input schema would enable validation at trigger time and structured injection into agent prompts.
created_at: 2026-03-31T15:07:46Z
updated_at: 2026-03-31T15:07:46Z
---

## Problem

`WorkflowRunTrigger` carries a `payload: Record<string, unknown>` that is passed verbatim to each step. Webhook-triggered workflows expect specific fields (e.g. `repoUrl`, `prNumber`) but there is no validation layer. If a caller sends a malformed payload, the workflow silently proceeds with missing fields, causing confusing agent failures deep in a run rather than a clear rejection at intake.

`WorkflowDefinitionInput` has no `inputSchema` field, so there is no machine-readable description of what a workflow expects.

## Desired Outcome

An optional `inputSchema` field on `WorkflowDefinitionInput` accepting a JSON Schema object. At trigger time, the runtime validates the payload against the schema and rejects the trigger with a descriptive error if validation fails. The schema is surfaced via `kota workflow list --definitions` and in the daemon control API (`/api/workflow/definitions`) so callers can discover expected inputs.

## Constraints

- Validation is opt-in: workflows without `inputSchema` behave exactly as today.
- Use `ajv` (already a transitive dependency in many Node ecosystems) or a small hand-written validator; do not pull in a large new dependency if avoidable.
- Schema must be serializable to JSON for storage and API exposure.
- Validation failure must produce a clear error that includes the offending field and constraint.

## Done When

- `WorkflowDefinitionInput` accepts an optional `inputSchema: Record<string, unknown>` field.
- The runtime validates trigger payloads against the schema when present.
- Invalid payloads are rejected before the run is queued, with a descriptive error.
- Schema is included in the definitions API response.
- Unit tests cover valid payload acceptance and invalid payload rejection.
