import { workflowUsesAgent } from "./run-executor-utils.js";
import type { WorkflowRuntimeDispatchState } from "./runtime-dispatch.js";
import type { WorkflowDefinition } from "./types.js";

type WorkflowDispatchConcurrencyState = Pick<
  WorkflowRuntimeDispatchState,
  | "projectDir"
  | "config"
  | "definitions"
  | "activeRuns"
  | "agentConcurrency"
  | "codeConcurrency"
>;

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

export function concurrencyLimitForDefinition(
  state: Pick<WorkflowDispatchConcurrencyState, "agentConcurrency" | "codeConcurrency">,
  definition: WorkflowDefinition,
): number {
  const group = getConcurrencyGroup(definition);
  if (group === "agent") return state.agentConcurrency;
  if (group === "code") return state.codeConcurrency;
  return 1;
}

function usesAgentGroup(definition: WorkflowDefinition): boolean {
  return getConcurrencyGroup(definition) === "agent";
}

function requiresExclusiveAgentSlot(definition: WorkflowDefinition): boolean {
  return definition.concurrencyGroup === "agent" && !workflowUsesAgent(definition);
}

function activeCountForGroup(state: WorkflowDispatchConcurrencyState, group: string): number {
  let count = 0;
  for (const run of state.activeRuns.values()) {
    const def = state.definitions.find((d) => d.name === run.workflowName);
    if (def && getConcurrencyGroup(def) === group) count++;
  }
  return count;
}

function activeCountForWorkflow(state: WorkflowDispatchConcurrencyState, workflowName: string): number {
  let count = 0;
  for (const run of state.activeRuns.values()) {
    if (run.workflowName === workflowName) count++;
  }
  return count;
}

function activeAgentWorkflowCount(state: WorkflowDispatchConcurrencyState): number {
  let count = 0;
  for (const run of state.activeRuns.values()) {
    const def = state.definitions.find((d) => d.name === run.workflowName);
    if (def && (usesAgentGroup(def) || workflowUsesAgent(def))) count++;
  }
  return count;
}

function hasActiveExclusiveAgentSlot(state: WorkflowDispatchConcurrencyState): boolean {
  for (const run of state.activeRuns.values()) {
    const def = state.definitions.find((d) => d.name === run.workflowName);
    if (def && requiresExclusiveAgentSlot(def)) return true;
  }
  return false;
}

function maxConcurrentRunsForWorkflow(
  state: WorkflowDispatchConcurrencyState,
  definition: WorkflowDefinition,
): number {
  const resolver = definition.maxConcurrentRuns;
  const raw =
    typeof resolver === "function"
      ? resolver({
          projectDir: state.projectDir,
          config: state.config,
          workflowName: definition.name,
          concurrencyLimit: concurrencyLimitForDefinition(state, definition),
        })
      : resolver;
  if (raw === undefined) return 1;
  if (!Number.isInteger(raw) || raw < 1) return 1;
  return raw;
}

export function canDispatchDefinition(
  state: WorkflowDispatchConcurrencyState,
  definition: WorkflowDefinition,
): boolean {
  if (
    activeCountForWorkflow(state, definition.name) >=
      maxConcurrentRunsForWorkflow(state, definition)
  ) {
    return false;
  }
  if (
    workflowUsesAgent(definition) &&
    activeAgentWorkflowCount(state) >= state.agentConcurrency
  ) {
    return false;
  }
  const group = getConcurrencyGroup(definition);
  if (workflowUsesAgent(definition) && hasActiveExclusiveAgentSlot(state)) {
    return false;
  }
  if (group === "agent") {
    if (requiresExclusiveAgentSlot(definition)) {
      return activeAgentWorkflowCount(state) === 0;
    }
  }
  return (
    activeCountForGroup(state, group) <
    concurrencyLimitForDefinition(state, definition)
  );
}
