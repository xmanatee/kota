---
id: task-workflow-step-model-config
title: Allow per-step model override in workflow definitions
status: backlog
priority: p3
area: workflow
summary: Let workflow authors specify a model override per step so cheap/fast steps can use smaller models (e.g., Haiku) while critical steps keep the default capable model. Reduces cost and latency without sacrificing quality where it matters.
created_at: 2026-03-20
updated_at: 2026-03-20
---

## Problem

Every workflow step currently uses the same model. Simple steps (e.g., a triage pass, a format check, a short summarization) could use a cheaper/faster model without meaningful quality loss, but there is no way to express this in the workflow definition.

## Desired Outcome

Workflow step definitions accept an optional `model` field:

```ts
{ type: "agent", model: "claude-haiku-4-5-20251001", prompt: "..." }
```

The runtime passes the override to the agent executor. If unset, the default model applies.

## Constraints

- The model/ layer already abstracts model selection; wire the override through there rather than adding new abstraction
- Validation should reject unknown model IDs at workflow load time
- Cost tracking (task-workflow-run-cost-tracking) should capture the actual model used per step

## Done When

- Workflow schema accepts `model` on agent step definitions
- Runtime passes the model override to the agent executor
- Validation rejects unknown model IDs with a clear error
- Existing workflows without the field are unaffected
