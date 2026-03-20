---
id: task-workflow-step-model-config
title: Validate per-step model IDs in workflow definitions
status: done
priority: p3
area: workflow
summary: The `model?` field on agent step definitions already exists and the runtime already uses it. What's missing is validation that rejects unknown model IDs at load time with a clear error.
created_at: 2026-03-20
updated_at: 2026-03-20T03:16:00Z
---

## Problem

`WorkflowAgentStepInput` already has a `model?: string` field and `step-executor.ts` already passes it to the agent SDK (`step.model ?? agentConfig.model ?? DEFAULT_MODEL`). However, `validation-steps.ts` only runs `expectOptionalString` on the field — it accepts any string. An invalid model ID silently falls through to the SDK, which fails at runtime rather than at workflow load time.

## Desired Outcome

- Validation rejects unknown model IDs with a clear error at workflow load time.
- Known valid model IDs are defined in one place (e.g., a constant list or pulled from the model layer).

## Constraints

- Do not re-implement the model field type or runtime wiring — both already exist and work.
- Validation should fail fast with a message like: `steps[N].model: unknown model "foo"`.
- Cost tracking (task-workflow-run-cost-tracking) should capture the actual model used per step once it lands.

## Done When

- Workflow validation rejects unknown model IDs with a clear error
- Existing workflows using `BUILTIN_WORKFLOW_MODEL` and workflows without the field are unaffected
