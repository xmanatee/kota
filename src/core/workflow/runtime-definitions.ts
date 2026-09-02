import { resolveAgentOperatingState } from "./agent-backoff.js";
import type { WorkflowEventBatchManager } from "./event-batches.js";
import { withWorkflowFailureAlert } from "./failure-alert.js";
import { deriveStoredWorkflowOperationalState } from "./run-operational-projection.js";
import type { RunStateDatabase } from "./run-state-database.js";
import type { WorkflowRuntimeSnapshot } from "./run-types.js";
import {
  loadDefinitions as loadDefinitionsViaDispatch,
  maybeStartNext,
  resolveDefinitions,
  type WorkflowRuntimeDispatchState,
} from "./runtime-dispatch.js";
import type { ScopeRuntimeStateStore } from "./scope-runtime-state.js";
import type { RegisteredWorkflowDefinitionInput, WorkflowDefinition } from "./types.js";
import type { WatchTriggerManager } from "./watch-triggers.js";

export interface WorkflowRuntimeDefinitionsState extends WorkflowRuntimeDispatchState {
  scopeId: string;
  runState: RunStateDatabase;
  watchTriggers: WatchTriggerManager;
  eventBatches: WorkflowEventBatchManager;
  scopeState: ScopeRuntimeStateStore;
  definitionSourceEnabled: Map<string, boolean>;
}

export function setWorkflowInputs(
  state: WorkflowRuntimeDefinitionsState,
  inputs: readonly RegisteredWorkflowDefinitionInput[],
): void {
  state.workflowInputs = withWorkflowFailureAlert(
    inputs,
    state.config?.notifications?.alertCooldownMs,
  );
}

export function reloadWorkflowDefinitions(
  state: WorkflowRuntimeDefinitionsState,
): { count: number } {
  const defs = loadDefinitionsViaDispatch(state);
  state.scheduleTriggers.reconcile(defs);
  state.eventBatches.setup(defs);
  state.watchTriggers.reconcile(defs, (handler) =>
    state.runtimeConfig.bus.on("file.changed", handler),
  );
  state.definitionSourceEnabled.clear();
  state.definitions = defs;
  return { count: defs.length };
}

export function validateDefinitions(
  state: WorkflowRuntimeDefinitionsState,
): { count: number } {
  const defs = resolveDefinitions(state);
  return { count: defs.length };
}

export function getDefinitionCount(state: WorkflowRuntimeDefinitionsState): number {
  return state.definitions.length;
}

export function getDefinitions(
  state: WorkflowRuntimeDefinitionsState,
): WorkflowDefinition[] {
  return state.definitions;
}

/**
 * Returns the source `enabled` value for a definition that has been
 * runtime-overridden, or undefined if no override is active.
 */
export function getDefinitionSourceEnabled(
  state: WorkflowRuntimeDefinitionsState,
  name: string,
): boolean | undefined {
  return state.definitionSourceEnabled.get(name);
}

export function disableWorkflow(
  state: WorkflowRuntimeDefinitionsState,
  name: string,
): { ok: boolean; notFound?: boolean } {
  const def = state.definitions.find((d) => d.name === name);
  if (!def) return { ok: false, notFound: true };
  if (!state.definitionSourceEnabled.has(name)) {
    state.definitionSourceEnabled.set(name, def.enabled);
  }
  def.enabled = false;
  state.wfQueue.cancelByWorkflow(name);
  return { ok: true };
}

export function enableWorkflow(
  state: WorkflowRuntimeDefinitionsState,
  name: string,
): { ok: boolean; notFound?: boolean } {
  const def = state.definitions.find((d) => d.name === name);
  if (!def) return { ok: false, notFound: true };
  if (!state.definitionSourceEnabled.has(name)) {
    state.definitionSourceEnabled.set(name, def.enabled);
  }
  def.enabled = true;
  maybeStartNext(state);
  return { ok: true };
}

export function getRuntimeState(
  state: WorkflowRuntimeDefinitionsState,
): WorkflowRuntimeSnapshot & {
  queueLength: number;
  concurrency: number;
} {
  const runtimeState = state.runState.readWorkflowSummary(state.scopeId);
  for (const [workflow, nextScheduledAt] of state.scheduleTriggers.nextScheduledAt()) {
    runtimeState.workflows[workflow] = {
      ...runtimeState.workflows[workflow],
      nextScheduledAt,
    };
  }
  const operationalState = deriveStoredWorkflowOperationalState(
    state.runState.listRuns(state.scopeId, [
      "queued",
      "running",
      "integrating",
    ]),
  );
  const activeAgentBackoff = state.backoff.getActive();
  return {
    ...runtimeState,
    ...operationalState,
    definitionsLoadedAt: state.definitionsLoadedAt,
    agentBackoff: activeAgentBackoff ?? undefined,
    agentOperatingState: resolveAgentOperatingState({
      runtimeId: state.backoff.getRuntimeId(),
      backoff: activeAgentBackoff,
      hasActiveAgentAttempt: state.backoff.hasActiveAttempt(state.scopeId),
    }),
    batchBuffers: state.scopeState.getBatchBuffers(),
    queueLength: operationalState.pendingRuns.length,
    concurrency: state.runCoordinator.capacity,
  };
}
