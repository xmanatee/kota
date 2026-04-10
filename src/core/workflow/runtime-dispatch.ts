import { existsSync } from "node:fs";
import { join } from "node:path";
import type { KotaConfig } from "#core/config/config.js";
import { getRepoWorktreeStatus } from "#root/repo-worktree.js";
import type { AgentBackoffManager } from "./agent-backoff.js";
import type { BudgetGuard } from "./budget-guard.js";
import { isWithinDispatchWindow } from "./dispatch-window.js";
import { executeWorkflowRun } from "./run-executor.js";
import { workflowUsesAgent } from "./run-executor-utils.js";
import type { WorkflowRunStore } from "./run-store.js";
import { formatRunId } from "./run-store-helpers.js";
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
  /** Max concurrent agent-step workflow runs. Default 1. */
  agentConcurrency: number;
  /** Max concurrent code-only workflow runs. Default 4. */
  codeConcurrency: number;
  runtimeConfig: WorkflowRuntimeConfig;
  model?: string;
  idleIntervalMs: number;
  workflowInputs?: readonly RegisteredWorkflowDefinitionInput[];
  log(message: string): void;
}

/**
 * Returns the concurrency group for a workflow definition.
 * Named groups serialize within themselves (cap 1).
 * Unnamed workflows fall into "agent" or "code" based on step types.
 */
function getConcurrencyGroup(definition: WorkflowDefinition): string {
  if (definition.concurrencyGroup) return definition.concurrencyGroup;
  return workflowUsesAgent(definition) ? "agent" : "code";
}

function activeCountForGroup(state: WorkflowRuntimeDispatchState, group: string): number {
  let count = 0;
  for (const workflowName of state.activeRuns.keys()) {
    const def = state.definitions.find((d) => d.name === workflowName);
    if (def && getConcurrencyGroup(def) === group) count++;
  }
  return count;
}

function canDispatchDefinition(
  state: WorkflowRuntimeDispatchState,
  definition: WorkflowDefinition,
): boolean {
  const group = getConcurrencyGroup(definition);
  let limit: number;
  if (group === "agent") {
    limit = state.agentConcurrency;
  } else if (group === "code") {
    limit = state.codeConcurrency;
  } else {
    limit = 1;
  }
  return activeCountForGroup(state, group) < limit;
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

function handleDirtyCompletion(
  state: WorkflowRuntimeDispatchState,
  definition: WorkflowDefinition,
  metadata: WorkflowRunExecutionResult["metadata"],
): void {
  const worktree = getRepoWorktreeStatus(state.projectDir);
  if (!worktree.available) return;

  if (!worktree.dirty) {
    if (state.store.getRecovery()) {
      state.store.setRecovery(null);
    }
    return;
  }

  state.wfQueue.setRuns([]);
  state.wfQueue.persist();

  const existing = state.store.getRecovery();
  if (existing && existing.attempts >= 1) {
    state.store.setRecovery({
      ...existing,
      sourceRunId: metadata.id,
      sourceWorkflow: definition.name,
      worktreeFingerprint: worktree.fingerprint,
      worktreeSummary: worktree.summary,
      updatedAt: new Date().toISOString(),
    });
    state.dispatchPaused = true;
    state.log(
      `Recovery already attempted for dirty worktree left by "${definition.name}" (${metadata.id}). Dispatch paused: ${worktree.summary}`,
    );
    return;
  }

  state.store.setRecovery({
    sourceRunId: metadata.id,
    sourceWorkflow: definition.name,
    worktreeFingerprint: worktree.fingerprint,
    worktreeSummary: worktree.summary,
    attempts: existing?.attempts ?? 0,
    updatedAt: new Date().toISOString(),
  });
  state.dispatchPaused = true;
  state.log(
    `Workflow "${definition.name}" completed with uncommitted changes. Restarting for recovery: ${worktree.summary}`,
  );
  state.runtimeConfig.bus.emit("runtime.restart_requested", {
    reason: `workflow "${definition.name}" completed with dirty worktree`,
    workflow: definition.name,
    runId: metadata.id,
  });
}

export function loadDefinitions(state: WorkflowRuntimeDispatchState): WorkflowDefinition[] {
  const definitions = state.workflowInputs ?? [];
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
  const dispatchWindow = state.config?.scheduler?.dispatchWindow;
  if (dispatchWindow && !isWithinDispatchWindow(dispatchWindow)) return;
  state.runtimeConfig.bus.emit("runtime.idle", {
    timestamp: new Date().toISOString(),
    idleIntervalMs: state.idleIntervalMs,
  });
}

export function maybeStartNext(state: WorkflowRuntimeDispatchState): void {
  if (state.stopping || state.dispatchPaused) return;
  if (existsSync(join(state.projectDir, ".kota", PAUSE_SIGNAL_FILE))) return;

  const budget = state.config?.dailyBudgetUsd;
  const warnAt = state.config?.budget?.warnAt;
  if (budget != null && state.budgetGuard.check(
    state.store,
    budget,
    (msg) => state.log(msg),
    (dailySpend, budgetAmt, text) => state.runtimeConfig.bus.emit("workflow.budget.exceeded", { dailySpend, budget: budgetAmt, text }),
    warnAt,
    (dailySpend, budgetAmt, warnAtVal, text) => state.runtimeConfig.bus.emit("workflow.budget.warning", { dailySpend, budget: budgetAmt, warnAt: warnAtVal, text }),
  )) return;

  let queued: ReturnType<typeof state.wfQueue.pick>;
  while ((queued = state.wfQueue.pick((def) => canDispatchDefinition(state, def)))) {
    const definition = state.definitions.find((d) => d.name === queued!.workflowName);
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

    state.log(`Dispatching workflow "${queued!.workflowName}"`);
    void runWorkflow(state, definition, queued!.trigger);
  }
}

async function triggerWorkflowFromStep(
  state: WorkflowRuntimeDispatchState,
  workflowName: string,
  payload: Record<string, unknown>,
  waitFor: "queued" | "completed",
  signal?: AbortSignal,
): Promise<{ runId: string; status: "queued" | "completed" | "failed"; childOutput?: unknown }> {
  const definition = state.definitions.find((d) => d.name === workflowName);
  if (!definition) {
    throw new Error(`Trigger step references unknown workflow "${workflowName}"`);
  }
  if (!definition.enabled) {
    throw new Error(`Trigger step references disabled workflow "${workflowName}"`);
  }

  const runId = formatRunId(workflowName);
  const now = Date.now();
  const runTrigger: WorkflowRunTrigger = {
    event: "workflow.triggered",
    payload: { ...payload, _runId: runId, triggeredAt: new Date().toISOString() },
  };

  if (waitFor === "queued") {
    const runtimeState = state.store.readState();
    state.store.setPendingRuns([
      ...runtimeState.pendingRuns,
      { runId, workflowName, trigger: runTrigger, enqueuedAtMs: now, notBeforeMs: now },
    ]);
    maybeStartNext(state);
    return { runId, status: "queued" };
  }

  // waitFor === "completed": subscribe to bus before enqueuing to avoid missing the event.
  return new Promise((resolve, reject) => {
    const stopListening = state.runtimeConfig.bus.on(
      "workflow.completed",
      (completedPayload) => {
        if (completedPayload.runId !== runId) return;
        stopListening();
        const status =
          completedPayload.status === "success" ||
          completedPayload.status === "completed-with-warnings"
            ? "completed"
            : "failed";
        const childMeta = state.store.getRun(runId);
        const lastSuccessfulStep = childMeta?.steps
          .slice()
          .reverse()
          .find((s) => s.status === "success");
        const childOutput = lastSuccessfulStep?.output;
        resolve({ runId, status, ...(childOutput !== undefined && { childOutput }) });
      },
    );

    if (signal) {
      signal.addEventListener(
        "abort",
        () => {
          stopListening();
          const reason = signal.reason instanceof Error ? signal.reason : new Error("Trigger step aborted");
          reject(reason);
        },
        { once: true },
      );
    }

    const runtimeState = state.store.readState();
    state.store.setPendingRuns([
      ...runtimeState.pendingRuns,
      { runId, workflowName, trigger: runTrigger, enqueuedAtMs: now, notBeforeMs: now },
    ]);
    maybeStartNext(state);
  });
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
    triggerWorkflow: (workflowName, payload, waitFor, signal) =>
      triggerWorkflowFromStep(state, workflowName, payload, waitFor, signal),
  });
  state.activeRuns.set(definition.name, { promise, abortController });

  try {
    const result = await promise;
    handleDirtyCompletion(state, definition, result.metadata);
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
