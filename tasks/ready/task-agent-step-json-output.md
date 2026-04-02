---
id: task-agent-step-json-output
title: Add structured JSON output extraction from agent step responses
status: ready
priority: p2
area: runtime
summary: Agent steps return raw text, but downstream code steps and predicates that need structured data must parse it manually. A convention for agents to emit a fenced JSON block that gets extracted into typed step output would reduce boilerplate and catch format errors early.
created_at: 2026-04-02T10:06:24Z
updated_at: 2026-04-02T10:06:24Z
---

## Problem

Agent steps run a prompt and expose the final assistant message as their output. When downstream `code` steps or `when` predicates need structured data (e.g., a list of changed files, a decision enum, a diff summary), they must parse free-form text themselves. This parsing is brittle, duplicated across workflows, and produces no useful error if the agent omits or malforms the expected format.

The workflow `outputSchema` field exists at the definition level but there is no mechanism to enforce or extract structured output from an individual agent step.

## Desired Outcome

An optional `outputFormat: "json"` field on agent steps that:

1. Appends a system-prompt instruction telling the agent to end its response with a fenced JSON block.
2. After the step completes, extracts the last fenced JSON block from the agent's final message as the step output (parsed to a JS value).
3. Validates the extracted value against an optional `outputSchema` (reusing the JSON Schema subset in `payload-validator.ts`) when provided.
4. Fails the step with a clear error if `outputFormat: "json"` is set but no valid JSON block is found or the value fails schema validation.

Without `outputFormat`, behavior is unchanged.

## Constraints

- Only affects `WorkflowAgentStep` type; no changes to other step types.
- Extraction logic belongs in `step-executor-agent.ts` or a small helper; keep it out of the prompt-building path.
- Schema validation reuses `validatePayloadSchema` from `workflow/payload-validator.ts`; do not introduce a second validator.
- The extracted JSON becomes the step's `output` in `WorkflowStepResult`, so downstream `typedCodeStep` and `when` predicates receive it typed.
- Append minimal prompt text: a single short instruction sentence, not a full format spec essay.

## Done When

- `WorkflowAgentStep` type accepts optional `outputFormat: "json"` and `outputSchema`.
- When `outputFormat: "json"` is set, the step output is the parsed JSON extracted from the last fenced block.
- When `outputSchema` is also provided, a schema mismatch fails the step with an actionable error.
- At least one unit test covers extraction success, extraction failure (missing block), and schema validation failure.
- Existing agent step tests are unaffected.
