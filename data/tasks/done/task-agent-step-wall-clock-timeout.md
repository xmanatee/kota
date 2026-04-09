---
id: task-agent-step-wall-clock-timeout
title: Add configurable wall-clock timeout for workflow agent steps
status: done
priority: p1
area: workflow
summary: Agent steps in the workflow runtime have no wall-clock timeout. A stuck LLM call or infinite agent loop will block the runtime indefinitely. Add an optional per-step timeout that aborts via the existing AbortController.
created_at: 2026-03-20
updated_at: 2026-03-20
---

## Problem

`executeAgentStep` in `src/workflow/step-executor.ts` passes an `AbortController` to `executeWithAgentSDK` but never sets a wall-clock deadline on it. If an agent step hangs (network issue, runaway tool loop, LLM API stall), the entire workflow runtime stalls with it. There is no recovery path short of restarting the process.

This is especially risky for overnight autonomous runs where the daemon has no external watchdog.

## Desired Outcome

- `WorkflowAgentStepInput` gains an optional `timeoutMs` field (default: no timeout, or a safe default like 30 minutes)
- `executeAgentStep` sets a `setTimeout` that calls `abortController.abort()` if the step exceeds the timeout
- The timeout fires as a step failure with a clear error message, allowing the run to proceed to verification or fail cleanly
- Existing agent step behavior is unchanged when `timeoutMs` is not set

## Constraints

- Do not add test-only production flags; timeout should be a natural configuration option
- The `abortController` already flows through step-executor; the change should be narrow
- No behavior change when `timeoutMs` is undefined

## Done When

- `WorkflowAgentStepInput` and `WorkflowAgentStep` types include optional `timeoutMs`
- `executeAgentStep` cancels the step after the timeout elapses
- Unit tests cover: step completes before timeout (passes), step exceeds timeout (fails with timeout error)
- `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` all pass
