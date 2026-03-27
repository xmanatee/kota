import { existsSync } from "node:fs";
import { join } from "node:path";
import type { KotaConfig } from "../config.js";
import type { AgentBackoffManager } from "./agent-backoff.js";
import type { BudgetGuard } from "./budget-guard.js";
import { getBuiltinWorkflowDefinitions } from "./registry.js";
import { executeWorkflowRun } from "./run-executor.js";
import { workflowUsesAgent } from "./run-executor-utils.js";
import type { WorkflowRunStore } from "./run-store.js";
import type { WorkflowRunExecutionResult } from "./run-types.js";
import type { WorkflowRuntimeConfig } from "./runtime-config.js";
import { checkAbortSignal, checkReloadSignal, PAUSE_SIGNAL_FILE } from "./runtime-signals.js";
import type { ScheduleTriggerManager } from "./schedule-triggers.js";
import type {
  RegisteredWorkflowDefinitionInput,
  WorkflowDefinition,
  WorkflowRunTrigger,
} from "./types.js";
import { validateWorkflowDefinitions } from "./validation.js";
import type { WorkflowQueueManager } from "./workflow-queue.js";

export interface WorkflowRuntimeDispatchState {
  projectDir: string;
  stopping: boolean;
  dispatchPaused: boolean;
  config?: KotaConfig;
  budgetGuard: BudgetGuard;
  store: WorkflowRunStore;
  wfQueue: WorkflowQueueManager;
  definitions: WorkflowDefinition[];
  scheduleTriggers: ScheduleTriggerManager;
  activeRuns: Map<
    string,
    { promise: Promise<WorkflowRunExecutionResult>; abortController: AbortController }
  >;
  backoff: AgentBackoffManager;
  maxConcurrentRuns: number;
  runtimeConfig: WorkflowRuntimeConfig;
  model?: string;
  idleIntervalMs: number;
  workflowInputs?: readonly RegisteredWorkflowDefinitionInput[];
  log(message: string): void;
}

function nextUtcMidnightIso(now = new Date()): string {
  const nextMidnight = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    0,
    0,
    0,
    0,
  );
  return new Date(nextMidnight).toISOString();
}

export function loadDefinitions(state: WorkflowRuntimeDispatchState): WorkflowDefinition[] {
  const definitions = state.workflowInputs ?? getBuiltinWorkflowDefinitions();
  const validated = validateWorkflowDefinitions(definitions, state.projectDir);
  const clearedBudgetPauses = state.store.reconcileWorkflowBudgetPauses(validated);
  state.store.setDefinitionsLoadedAt(new Date().toISOString());
  if (clearedBudgetPauses.length > 0) {
    state.log(
      `Cleared stale workflow budget pause(s): ${clearedBudgetPauses.join(", ")}`,
    );
  }
  return validated;
}

export function emitIdleEvent(state: WorkflowRuntimeDispatchState): void {
  checkAbortSignal(state.projectDir, state.activeRuns, (msg) => state.log(msg));
  checkReloadSignal(
    state.projectDir,
    () => loadDefinitions(state),
    (defs) => {
      state.scheduleTriggers.reconcile(defs);
      state.definitions = defs;
    },
    (msg) => state.log(msg),
  );
  maybeStartNext(state);
  if (state.stopping || state.activeRuns.size > 0 || state.wfQueue.length > 0) return;
  state.runtimeConfig.bus.emit("runtime.idle", {
    timestamp: new Date().toISOString(),
    idleIntervalMs: state.idleIntervalMs,
  });
}

export function maybeStartNext(state: WorkflowRuntimeDispatchState): void {
  if (state.stopping || state.dispatchPaused) return;
  if (existsSync(join(state.projectDir, ".kota", PAUSE_SIGNAL_FILE))) return;

  const budget = state.config?.dailyBudgetUsd;
  if (budget != null && state.budgetGuard.check(state.store, budget, (msg) => state.log(msg))) return;

  while (state.activeRuns.size < state.maxConcurrentRuns) {
    const queued = state.wfQueue.pick();
    if (!queued) break;

    const definition = state.definitions.find((d) => d.name === queued.workflowName);
    if (!definition) continue;

    if (definition.dailyBudgetUsd == null) {
      state.store.clearWorkflowBudgetPause(definition.name);
    } else {
      const pausedUntil = state.store.getWorkflowBudgetPauseUntil(definition.name);
      if (pausedUntil) {
        continue;
      }
      const wfSpend = state.store.getDailySpendUsd(definition.name);
      if (wfSpend >= definition.dailyBudgetUsd) {
        const pauseUntil = nextUtcMidnightIso();
        state.store.setWorkflowBudgetPauseUntil(definition.name, pauseUntil);
        state.log(
          `Daily budget of $${definition.dailyBudgetUsd.toFixed(4)} reached for workflow "${definition.name}" ($${wfSpend.toFixed(4)} spent today). Pausing it until ${pauseUntil}.`,
        );
        continue;
      }
      state.store.clearWorkflowBudgetPause(definition.name);
    }

    state.log(`Dispatching workflow "${queued.workflowName}"`);
    void runWorkflow(state, definition, queued.trigger);
  }
}

export async function runWorkflow(
  state: WorkflowRuntimeDispatchState,
  definition: WorkflowDefinition,
  trigger: WorkflowRunTrigger,
): Promise<void> {
  const { promise, abortController } = executeWorkflowRun(definition, trigger, {
    projectDir: state.projectDir,
    bus: state.runtimeConfig.bus,
    store: state.store,
    model: state.model,
    config: state.config,
    log: (message) => state.log(message),
  });
  state.activeRuns.set(definition.name, { promise, abortController });

  try {
    const result = await promise;
    if (result.agentBackoff) {
      state.backoff.apply(result.agentBackoff);
      return;
    }
    if (
      workflowUsesAgent(definition) &&
      (result.metadata.status === "success" ||
        result.metadata.status === "completed-with-warnings")
    ) {
      state.backoff.clear();
    }
  } finally {
    state.activeRuns.delete(definition.name);
    maybeStartNext(state);
  }
}
