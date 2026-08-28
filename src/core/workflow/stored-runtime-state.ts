import { existsSync } from "node:fs";
import { join } from "node:path";
import { deriveStoredWorkflowOperationalState } from "./run-operational-projection.js";
import { RunStateDatabase } from "./run-state-database.js";
import type { WorkflowRuntimeSnapshot } from "./runtime-state-types.js";
import { ScopeRuntimeStateStore } from "./scope-runtime-state.js";

export type StoredWorkflowRuntimeState = WorkflowRuntimeSnapshot & {
  operatorPaused: boolean;
};

const EMPTY_STORED_RUNTIME_STATE: StoredWorkflowRuntimeState = {
  completedRuns: 0,
  workflows: {},
  activeRuns: [],
  pendingRuns: [],
  batchBuffers: {},
  operatorPaused: false,
};

function withStoredScope<T>(
  scopeRoot: string,
  stateDir: string,
  access: "read-only" | "write",
  operation: (database: RunStateDatabase, scopeId: string) => T,
): T | null {
  if (!existsSync(join(stateDir, "kota.sqlite"))) return null;
  const database = access === "read-only"
    ? RunStateDatabase.openReadOnly(stateDir)
    : RunStateDatabase.openExisting(stateDir);
  try {
    const scopeId = database.getScopeIdByRootPath(scopeRoot);
    return scopeId === null ? null : operation(database, scopeId);
  } finally {
    database.close();
  }
}

/** Read-only offline projection from an explicitly selected daemon state root. */
export function readStoredWorkflowRuntimeState(
  scopeRoot: string,
  stateDir: string,
): StoredWorkflowRuntimeState {
  return withStoredScope(scopeRoot, stateDir, "read-only", (database, scopeId) => {
    const state = new ScopeRuntimeStateStore(database, scopeId);
    const backoff = state.getAgentBackoff();
    return {
      ...database.readWorkflowSummary(scopeId),
      ...deriveStoredWorkflowOperationalState(
        database.listRuns(scopeId, ["queued", "running", "integrating"]),
      ),
      ...(backoff !== null ? { agentBackoff: backoff } : {}),
      batchBuffers: state.getBatchBuffers(),
      operatorPaused: state.getDispatchPaused(),
    };
  }) ?? structuredClone(EMPTY_STORED_RUNTIME_STATE);
}

export function setStoredDispatchPaused(
  scopeRoot: string,
  stateDir: string,
  paused: boolean,
): boolean {
  const changed = withStoredScope(scopeRoot, stateDir, "write", (database, scopeId) => {
    const state = new ScopeRuntimeStateStore(database, scopeId);
    if (state.getDispatchPaused() === paused) return false;
    state.setDispatchPaused(paused);
    return true;
  });
  if (changed === null) {
    throw new Error(`No canonical workflow state exists for ${scopeRoot}`);
  }
  return changed;
}

export function clearStoredAgentBackoff(
  scopeRoot: string,
  stateDir: string,
): boolean {
  return withStoredScope(scopeRoot, stateDir, "write", (database, scopeId) => {
    const state = new ScopeRuntimeStateStore(database, scopeId);
    const backoff = state.getAgentBackoff();
    if (backoff === null) return false;
    database.releaseQueuedRunsDeferredUntil(
      scopeId,
      backoff.until,
      new Date().toISOString(),
    );
    state.setAgentBackoff(null);
    return true;
  }) ?? false;
}
