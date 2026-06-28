import { workflowUsesAgent } from "./run-executor-utils.js";
import type { WorkflowRuntimeDispatchState } from "./runtime-dispatch.js";
import type { WorkflowDefinition } from "./types.js";

/**
 * Returns the concurrency group for a workflow definition.
 * Named groups serialize within themselves (cap 1), except the reserved
 * "agent" and "code" groups. Unnamed workflows fall into "agent" or "code"
 * based on step types.
 */
function getConcurrencyGroup(definition: WorkflowDefinition): string {
  if (definition.concurrencyGroup) return definition.concurrencyGroup;
  return workflowUsesAgent(definition) ? "agent" : "code";
}

function usesAgentGroup(definition: WorkflowDefinition): boolean {
  return getConcurrencyGroup(definition) === "agent";
}

function requiresExclusiveAgentSlot(definition: WorkflowDefinition): boolean {
  return definition.concurrencyGroup === "agent" && !workflowUsesAgent(definition);
}

function activeCountForGroup(state: WorkflowRuntimeDispatchState, group: string): number {
  let count = 0;
  for (const run of state.activeRuns.values()) {
    const def = state.definitions.find((d) => d.name === run.workflowName);
    if (def && getConcurrencyGroup(def) === group) count++;
  }
  return count;
}

function activeCountForWorkflow(state: WorkflowRuntimeDispatchState, workflowName: string): number {
  let count = 0;
  for (const run of state.activeRuns.values()) {
    if (run.workflowName === workflowName) count++;
  }
  return count;
}

function activeAgentWorkflowCount(state: WorkflowRuntimeDispatchState): number {
  let count = 0;
  for (const run of state.activeRuns.values()) {
    const def = state.definitions.find((d) => d.name === run.workflowName);
    if (def && (usesAgentGroup(def) || workflowUsesAgent(def))) count++;
  }
  return count;
}

function hasActiveExclusiveAgentSlot(state: WorkflowRuntimeDispatchState): boolean {
  for (const run of state.activeRuns.values()) {
    const def = state.definitions.find((d) => d.name === run.workflowName);
    if (def && requiresExclusiveAgentSlot(def)) return true;
  }
  return false;
}

function maxConcurrentRunsForWorkflow(
  state: WorkflowRuntimeDispatchState,
  definition: WorkflowDefinition,
): number {
  const resolver = definition.maxConcurrentRuns;
  const raw =
    typeof resolver === "function"
      ? resolver({
          projectDir: state.projectDir,
          config: state.config,
          workflowName: definition.name,
        })
      : resolver;
  if (raw === undefined) return 1;
  if (!Number.isInteger(raw) || raw < 1) return 1;
  return raw;
}

export function canDispatchDefinition(
  state: WorkflowRuntimeDispatchState,
  definition: WorkflowDefinition,
): boolean {
  if (
    activeCountForWorkflow(state, definition.name) >=
      maxConcurrentRunsForWorkflow(state, definition)
  ) {
    return false;
  }
  const group = getConcurrencyGroup(definition);
  let limit: number;
  if (workflowUsesAgent(definition) && hasActiveExclusiveAgentSlot(state)) {
    return false;
  }
  if (group === "agent") {
    if (requiresExclusiveAgentSlot(definition)) {
      return activeAgentWorkflowCount(state) === 0;
    }
    limit = state.agentConcurrency;
  } else if (group === "code") {
    limit = state.codeConcurrency;
  } else {
    limit = 1;
  }
  return activeCountForGroup(state, group) < limit;
}
