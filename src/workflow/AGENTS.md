# Workflow Runtime

This directory contains the autonomous workflow runtime, validation, registry, and persisted run state.

- Keep workflow protocols strict, restart-safe, and easy to reason about.
- Put top-level autonomous execution semantics here, not in prompts or scheduler side channels.

## Key Modules

- `types.ts` — Workflow definition types: triggers, step kinds, `WorkflowDefinition`, and related config. 215 lines.
- `run-types.ts` — Runtime execution types: run status, step status, active run, queued run, execution context, predicates, repair config, step/run results.
- `runtime.ts` — `WorkflowRuntime` orchestrator: lifecycle, public API, state container. ~236 lines.
- `runtime-dispatch.ts` — Extracted dispatch functions (`loadDefinitions`, `emitIdleEvent`, `maybeStartNext`, `runWorkflow`) and `WorkflowRuntimeDispatchState` interface.
- `runtime-config.ts` — `WorkflowRuntimeConfig` type definition.
- `runtime-signals.ts` — `checkAbortSignal`, `checkReloadSignal`, and signal-file constants.
- `budget-guard.ts` — `BudgetGuard`: daily spend tracking and Telegram budget alerts.
- `workflow-queue.ts` — `WorkflowQueueManager`: queue state, enqueue, pick, restore, persist.
- `agent-backoff.ts` — `AgentBackoffManager`: per-agent backoff state and suppression logic.
- `schedule-triggers.ts` — `ScheduleTriggerManager`: cron and interval trigger scheduling.
- `run-executor.ts` — `executeWorkflowRun`: core step loop and run orchestration.
- `run-executor-step.ts` — `executeWorkflowStep` (single non-parallel step execution) and `buildSkippedResult` (skipped step handling with child-skipping for parallel steps).
- `run-executor-utils.ts` — Pure utilities: `matchesFilter`, `getEligibleAtMs`, `findRetryFromIndex`, `buildRetryInitialState`, `enqueueMatchingWorkflows`, `workflowUsesAgent`.
- `step-context.ts` — `createStepContext` and step context helpers.
- `step-executor.ts` / `step-executor-agent.ts` / `step-executor-parallel.ts` — Step dispatch by type.
- `validation.ts` / `validation-primitives.ts` — Workflow definition validation orchestration and shared primitives.
- `validation-trigger.ts` — `validateTrigger` and trigger-type-specific validation helpers.
- `validation-steps.ts` — Thin re-export barrel for `step-validators/`.
- `step-validators/` — Per-step-type validator modules (agent, code, emit, restart, tool, parallel).
- `run-store.ts` — `WorkflowRunStore`: directory management, list/load/delete runs. Re-exports `ActiveWorkflowRunHandle`.
- `active-run-handle.ts` — `ActiveWorkflowRunHandle` and `createActiveRunHandle`: append messages, record steps, finish runs.
- `run-store-helpers.ts` — Runtime-state validation/assertion helpers, snapshot and summary builders. Re-exports from `run-io.ts`.
- `run-io.ts` — Generic file IO utilities: `ensureDir`, `safeJsonStringify`, `writeJsonFile`, `formatRunId`.
