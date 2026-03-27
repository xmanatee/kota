# Workflow Runtime

This directory contains the autonomous workflow runtime, validation, registry, and persisted run state.

- Keep workflow protocols strict, restart-safe, and easy to reason about.
- Put top-level autonomous execution semantics here, not in prompts or scheduler side channels.

## Key Modules

- `runtime.ts` — `WorkflowRuntime` orchestrator: lifecycle, dispatch, budget enforcement. ~382 lines.
- `workflow-queue.ts` — `WorkflowQueueManager`: queue state, enqueue, pick, restore, persist.
- `agent-backoff.ts` — `AgentBackoffManager`: per-agent backoff state and suppression logic.
- `schedule-triggers.ts` — `ScheduleTriggerManager`: cron and interval trigger scheduling.
- `run-executor.ts` — `executeWorkflowRun`: core step loop and run orchestration.
- `run-executor-utils.ts` — Pure utilities: `matchesFilter`, `getEligibleAtMs`, `findRetryFromIndex`, `buildRetryInitialState`.
- `step-context.ts` — `createStepContext` and step context helpers.
- `step-executor.ts` / `step-executor-agent.ts` / `step-executor-parallel.ts` — Step dispatch by type.
- `validation.ts` / `validation-steps.ts` / `validation-primitives.ts` — Workflow definition validation.
- `run-store.ts` / `run-store-helpers.ts` — Persisted run state read/write.
