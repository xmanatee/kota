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
- `validation.ts` / `validation-primitives.ts` — Workflow definition validation orchestration and shared primitives.
- `validation-steps.ts` — Thin re-export barrel for `step-validators/`.
- `step-validators/` — Per-step-type validator modules (agent, code, emit, restart, tool, parallel).
- `run-store.ts` — `WorkflowRunStore`: directory management, list/load/delete runs. Re-exports `ActiveWorkflowRunHandle`.
- `active-run-handle.ts` — `ActiveWorkflowRunHandle` and `createActiveRunHandle`: append messages, record steps, finish runs.
- `run-store-helpers.ts` — Validation/assertion helpers, file IO utilities, snapshot and summary builders.
