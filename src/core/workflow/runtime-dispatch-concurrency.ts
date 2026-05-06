import { workflowUsesAgent } from "./run-executor-utils.js";
import type { WorkflowRuntimeDispatchState } from "./runtime-dispatch.js";
import type { WorkflowDefinition } from "./types.js";

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

export function canDispatchDefinition(
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
