# Workflow Runtime

This directory contains the autonomous workflow runtime, validation, registry, and persisted run state.

- Keep workflow protocols strict, restart-safe, and easy to reason about.
- Put top-level autonomous execution semantics here, not in prompts or scheduler side channels.

## Key Modules

- `types.ts` — Workflow definition types: triggers, step kinds, `WorkflowDefinition`, `typedCodeStep` factory, and related config.
- `run-types.ts` — Runtime execution types: run status, step status, active run, queued run, execution context, predicates, repair config, step/run results.
- `runtime.ts` — `WorkflowRuntime` orchestrator: lifecycle, public API, state container. ~236 lines.
- `runtime-dispatch.ts` — Extracted dispatch functions (`loadDefinitions`, `emitIdleEvent`, `maybeStartNext`, `runWorkflow`) and `WorkflowRuntimeDispatchState` interface.
- `runtime-config.ts` — `WorkflowRuntimeConfig` type definition.
- `runtime-signals.ts` — `checkAbortSignal`, `checkReloadSignal`, and signal-file constants.
- `budget-guard.ts` — `BudgetGuard`: daily spend tracking; emits `workflow.budget.exceeded` and `workflow.cost.limit.reached` bus events when thresholds are crossed.
- `workflow-queue.ts` — `WorkflowQueueManager`: queue state, enqueue (with inputSchema payload validation), pick, restore, persist.
- `payload-validator.ts` — `validatePayloadSchema`: minimal JSON Schema validator (type, required, properties, additionalProperties, items) used to validate trigger payloads against a workflow's optional `inputSchema`.
- `agent-backoff.ts` — `AgentBackoffManager`: per-agent backoff state and suppression logic.
- `schedule-triggers.ts` — `ScheduleTriggerManager`: cron and interval trigger scheduling.
- `watch-triggers.ts` — `WatchTriggerManager`: file-watch trigger management; subscribes to `file.changed` bus events, matches glob patterns, and fires `files.changed` run triggers after debounce.
- `run-executor.ts` — `executeWorkflowRun`: core step loop and run orchestration.
- `run-executor-step.ts` — `executeWorkflowStep` (single non-parallel step execution) and `buildSkippedResult` (skipped step handling with recursive child-skipping for parallel, branch, and foreach steps).
- `run-executor-utils.ts` — Pure utilities: `matchesFilter`, `getEligibleAtMs`, `findRetryFromIndex`, `buildRetryInitialState`, `enqueueMatchingWorkflows`, `workflowUsesAgent`.
- `step-context.ts` — `createStepContext` and step context helpers.
- `step-executor.ts` / `step-executor-agent.ts` / `step-executor-parallel.ts` / `step-executor-branch.ts` / `step-executor-foreach.ts` — Step dispatch by type.
- `step-executor-trigger.ts` — `executeTriggerStep`: enqueues or awaits another workflow; `{{...}}` payload interpolation.
- `step-executor-retry.ts` — Retry/backoff primitives: `AgentStepRuntimeError`, `DEFAULT_MODEL`, `withRetry`, `classifyAgentRuntimeFailure`.
- `validation.ts` / `validation-primitives.ts` — Workflow definition validation orchestration and shared primitives.
- `validation-trigger.ts` — `validateTrigger` and trigger-type-specific validation helpers.
- `validation-steps.ts` — Thin re-export barrel for `step-validators/`.
- `step-validators/` — Per-step-type validator modules (agent, branch, code, emit, foreach, restart, tool, parallel, trigger).
- `run-store.ts` — `WorkflowRunStore`: directory management, list/load/delete runs. Re-exports `ActiveWorkflowRunHandle`.
- `active-run-handle.ts` — `ActiveWorkflowRunHandle` and `createActiveRunHandle`: append messages, record steps, finish runs.
- `run-store-helpers.ts` — Runtime-state validation/assertion helpers, snapshot and summary builders. Re-exports from `run-io.ts`.
- `run-io.ts` — Generic file IO utilities: `ensureDir`, `safeJsonStringify`, `writeJsonFile`, `formatRunId`.

## Typed Code Step Pattern

Use `typedCodeStep<T>` from `types.ts` when a code step's output is consumed by downstream
steps or `when` predicates. It returns a `TypedCodeStepInput<T>` that is assignable to any
`WorkflowCodeStepInput` slot and adds an `output(context)` accessor typed as `T`:

```ts
import { typedCodeStep } from "../workflow/types.js";

const myStep = typedCodeStep<MyOutputType>({
  id: "my-step",
  type: "code",
  run: (): MyOutputType => ({ ... }),
});

// Use myStep directly in the steps array.
// Downstream steps access the output without casts:
when: (ctx) => myStep.output(ctx).someField > 0,
```

The runtime representation is unchanged (`stepOutputs` remains `Record<string, unknown>`).
Untyped code steps are still valid — only adopt this pattern when downstream type safety
is needed.
