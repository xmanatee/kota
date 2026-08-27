---
status: done
---

# Split workflow/step-executor-agent.ts — extract retry logic into step-executor-retry.ts

## Problem

`workflow/step-executor-agent.ts` is 288 lines and nearing the 300-line file size limit. The retry/backoff logic (error class, constants, sleep helper, `withRetry`, `classifyAgentRuntimeFailure`) is a distinct concern mixed into the same file as agent prompt construction and step execution.

## Desired Outcome

Extract the retry/backoff group into `workflow/step-executor-retry.ts`:
- `AgentStepRuntimeError`
- `DEFAULT_MODEL`
- `sleep` (private helper)
- `withRetry`
- `classifyAgentRuntimeFailure`

`step-executor-agent.ts` retains only `AgentStepConfig`, `WorkflowStepOutput`, `buildAgentPrompt`, and `executeAgentStep`, importing the retry primitives from the new file.

## Constraints

- No behavior changes — this is a structural split only.
- All existing imports of `step-executor-agent.ts` must continue to work.
- The new file must not re-export everything; only the public API needed by callers.

## Done When

- `step-executor-retry.ts` exists with the retry/backoff group.
- `step-executor-agent.ts` is measurably shorter (under 220 lines).
- `npm run typecheck`, `npm run test`, and `npm run lint` all pass.
