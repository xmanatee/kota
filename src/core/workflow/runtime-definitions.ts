import type { WorkflowRuntimeState } from "./run-types.js";
import {
  loadDefinitions as loadDefinitionsViaDispatch,
  maybeStartNext,
  resolveDefinitions,
  type WorkflowRuntimeDispatchState,
} from "./runtime-dispatch.js";
import type { RegisteredWorkflowDefinitionInput, WorkflowDefinition } from "./types.js";
import type { WatchTriggerManager } from "./watch-triggers.js";

export interface WorkflowRuntimeDefinitionsState extends WorkflowRuntimeDispatchState {
  watchTriggers: WatchTriggerManager;
  definitionSourceEnabled: Map<string, boolean>;
}

export function setWorkflowInputs(
  state: WorkflowRuntimeDefinitionsState,
  inputs: readonly RegisteredWorkflowDefinitionInput[],
): void {
  state.workflowInputs = inputs;
}

export function reloadWorkflowDefinitions(
  state: WorkflowRuntimeDefinitionsState,
): { count: number } {
  const defs = loadDefinitionsViaDispatch(state);
  state.scheduleTriggers.reconcile(defs);
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
): WorkflowRuntimeState & {
  queueLength: number;
  agentConcurrency: number;
  codeConcurrency: number;
} {
  const runtimeState = state.store.readState();
  const activeAgentBackoff = state.backoff.getActive();
  return {
    ...runtimeState,
    agentBackoff: activeAgentBackoff ?? undefined,
    queueLength: state.wfQueue.length,
    agentConcurrency: state.agentConcurrency,
    codeConcurrency: state.codeConcurrency,
  };
}
