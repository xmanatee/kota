---
id: task-agent-step-schema-retry-feedback
title: Feed schema validation errors back to agent on JSON output retry
status: done
priority: p2
area: workflow-runtime
summary: When a workflow agent step with outputFormat:"json" and outputSchema produces JSON that fails validation, retry attempts re-run the agent with no context about what went wrong. Injecting the validation error into the retry prompt would let the agent correct its output instead of blindly repeating the same mistake.
created_at: 2026-04-09T04:20:00Z
updated_at: 2026-04-09T04:20:00Z
---

## Problem

`src/core/workflow/step-executor-agent.ts` validates agent JSON output against `outputSchema` inside `extractJsonOutput`. When validation fails, it throws an `Error` that propagates to the step executor. If the step has `retry` configured, `withRetry` in `step-executor-retry.ts` catches the error and re-runs the full agent step — but the re-run receives the original prompt with no mention of why the previous attempt was rejected.

The agent has no idea its JSON was invalid. It will produce the same malformed or incomplete structure again, burning all retry attempts on identical failures.

Current behavior:
```
Attempt 1: agent returns JSON missing required field "status" → validation throws
Attempt 2: same prompt, same agent, same missing field → validation throws again
Attempt 3: same → run fails
```

## Desired Outcome

When an agent step fails schema validation and has retries remaining, the next attempt appends the validation error to the prompt as a correction note:

```
[Previous output failed schema validation: payload.status: required field missing.
 Please include all required fields in your JSON block and try again.]
```

The agent can then fix its output. The correction note is stripped on a successful attempt (not stored as part of the run's prompt history artifact).

## Constraints

- Only applies to `outputFormat: "json"` agent steps with `outputSchema` set.
- Only injects feedback when retrying after a schema validation failure — not for other error types (API errors, non-JSON output, etc.).
- The injected correction is appended to the step prompt for that attempt only; it does not modify the stored workflow step definition.
- Feedback injection must work whether the step prompt is a string or a template-rendered string.
- All existing retry behavior for non-schema errors is unchanged.

## Done When

- An agent step that fails JSON schema validation on attempt 1 receives the validation error message as a correction note on attempt 2.
- Existing tests for `step-executor-agent.ts` and `step-executor-retry.ts` still pass.
- A new test covers the feedback injection path: mock agent returns bad JSON on first attempt, receives the correction note, and returns valid JSON on the second attempt.
