import { existsSync } from "node:fs";
import { join } from "node:path";
import { ProjectRuntimeStateStore } from "./project-runtime-state.js";
import { projectStoredWorkflowOperationalState } from "./run-operational-projection.js";
import { RunStateDatabase } from "./run-state-database.js";
import type { WorkflowRuntimeSnapshot } from "./runtime-state-types.js";

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

function withStoredProject<T>(
  projectDir: string,
  stateDir: string,
  access: "read-only" | "write",
  operation: (database: RunStateDatabase, projectId: string) => T,
): T | null {
  if (!existsSync(join(stateDir, "kota.sqlite"))) return null;
  const database = access === "read-only"
    ? RunStateDatabase.openReadOnly(stateDir)
    : RunStateDatabase.openExisting(stateDir);
  try {
    const projectId = database.getProjectIdByRootPath(projectDir);
    return projectId === null ? null : operation(database, projectId);
  } finally {
    database.close();
  }
}

/** Read-only offline projection from an explicitly selected daemon state root. */
export function readStoredWorkflowRuntimeState(
  projectDir: string,
  stateDir: string,
): StoredWorkflowRuntimeState {
  return withStoredProject(projectDir, stateDir, "read-only", (database, projectId) => {
    const state = new ProjectRuntimeStateStore(database, projectId);
    const backoff = state.getAgentBackoff();
    return {
      ...database.readWorkflowSummary(projectId),
      ...projectStoredWorkflowOperationalState(
        database.listRuns(projectId, ["queued", "running", "integrating"]),
      ),
      ...(backoff !== null ? { agentBackoff: backoff } : {}),
      batchBuffers: state.getBatchBuffers(),
      operatorPaused: state.getDispatchPaused(),
    };
  }) ?? structuredClone(EMPTY_STORED_RUNTIME_STATE);
}

export function setStoredDispatchPaused(
  projectDir: string,
  stateDir: string,
  paused: boolean,
): boolean {
  const changed = withStoredProject(projectDir, stateDir, "write", (database, projectId) => {
    const state = new ProjectRuntimeStateStore(database, projectId);
    if (state.getDispatchPaused() === paused) return false;
    state.setDispatchPaused(paused);
    return true;
  });
  if (changed === null) {
    throw new Error(`No canonical workflow state exists for ${projectDir}`);
  }
  return changed;
}

export function clearStoredAgentBackoff(
  projectDir: string,
  stateDir: string,
): boolean {
  return withStoredProject(projectDir, stateDir, "write", (database, projectId) => {
    const state = new ProjectRuntimeStateStore(database, projectId);
    if (state.getAgentBackoff() === null) return false;
    state.setAgentBackoff(null);
    return true;
  }) ?? false;
}
