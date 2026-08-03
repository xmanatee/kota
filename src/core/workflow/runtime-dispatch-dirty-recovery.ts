import { getRepoWorktreeStatus } from "#core/util/repo-worktree.js";
import type {
  WorkflowRecoveryDirtyCheckout,
  WorkflowRunExecutionResult,
} from "./run-types.js";
import type { WorkflowRuntimeDispatchState } from "./runtime-dispatch.js";
import type { WorkflowDefinition } from "./types.js";

function pauseDispatchForDirtyWorktree(state: WorkflowRuntimeDispatchState): void {
  state.wfQueue.persist();
  state.dispatchPaused = true;
}

function workspaceDirFor(state: WorkflowRuntimeDispatchState): string {
  return state.workspaceDir ?? state.runtimeConfig.workspaceDir ?? state.projectDir;
}

function dirtyCheckoutFor(
  state: WorkflowRuntimeDispatchState,
): WorkflowRecoveryDirtyCheckout {
  return workspaceDirFor(state) === state.projectDir ? "canonical" : "workspace";
}

function checkoutLabel(dirtyCheckout: WorkflowRecoveryDirtyCheckout): string {
  return dirtyCheckout === "workspace" ? "Workspace checkout" : "Canonical checkout";
}

function restartReasonLabel(dirtyCheckout: WorkflowRecoveryDirtyCheckout): string {
  return dirtyCheckout === "workspace" ? "workspace checkout" : "worktree";
}

export function handleDirtyCompletion(
  state: WorkflowRuntimeDispatchState,
  definition: WorkflowDefinition,
  metadata: WorkflowRunExecutionResult["metadata"],
  preRunFingerprint: string,
): void {
  const worktree = getRepoWorktreeStatus(workspaceDirFor(state));
  if (!worktree.available) return;
  const dirtyCheckout = dirtyCheckoutFor(state);
  const label = checkoutLabel(dirtyCheckout);

  if (!worktree.dirty) {
    if (state.store.getRecovery()) {
      state.store.setRecovery(null);
    }
    return;
  }

  const existing = state.store.getRecovery();

  const otherActiveWorkflows = [...state.activeRuns.values()]
    .filter((run) => run.runId !== metadata.id)
    .map((run) => run.workflowName);
  if (otherActiveWorkflows.length > 0) {
    state.log(
      `${label} dirty after "${definition.name}" while ${otherActiveWorkflows.join(", ")} still active - deferring attribution: ${worktree.summary}`,
    );
    return;
  }

  if (worktree.fingerprint === preRunFingerprint) {
    const attemptedAt = new Date().toISOString();
    if (existing) {
      state.store.setRecovery({
        ...existing,
        retryAttemptedBy: [
          ...existing.retryAttemptedBy,
          { workflow: definition.name, runId: metadata.id, attemptedAt },
        ],
        updatedAt: attemptedAt,
      });
      pauseDispatchForDirtyWorktree(state);
      state.log(
        `${label} still dirty after "${definition.name}" and recovery already owns the same fingerprint - dispatch paused: ${worktree.summary}`,
      );
      return;
    }
    state.store.setRecovery({
      sourceRunId: metadata.id,
      sourceWorkflow: definition.name,
      dirtyCheckout,
      worktreeFingerprint: worktree.fingerprint,
      worktreeSummary: worktree.summary,
      attempts: 1,
      retryAttemptedBy: [{ workflow: definition.name, runId: metadata.id, attemptedAt }],
      updatedAt: attemptedAt,
    });
    pauseDispatchForDirtyWorktree(state);
    state.log(
      `${label} was already dirty before "${definition.name}" and remained dirty - dispatch paused: ${worktree.summary}`,
    );
    return;
  }

  pauseDispatchForDirtyWorktree(state);
  if (existing && existing.attempts >= 1) {
    state.store.setRecovery({
      ...existing,
      dirtyCheckout,
      worktreeFingerprint: worktree.fingerprint,
      worktreeSummary: worktree.summary,
      retryAttemptedBy: [
        ...existing.retryAttemptedBy,
        { workflow: definition.name, runId: metadata.id, attemptedAt: new Date().toISOString() },
      ],
      updatedAt: new Date().toISOString(),
    });
    state.dispatchPaused = true;
    state.log(
      `Recovery already attempted for dirty ${label.toLowerCase()} left by "${existing.sourceWorkflow}" (${existing.sourceRunId}). Dispatch paused: ${worktree.summary}`,
    );
    return;
  }

  state.store.setRecovery({
    sourceRunId: metadata.id,
    sourceWorkflow: definition.name,
    dirtyCheckout,
    worktreeFingerprint: worktree.fingerprint,
    worktreeSummary: worktree.summary,
    attempts: existing?.attempts ?? 0,
    retryAttemptedBy: existing?.retryAttemptedBy ?? [],
    updatedAt: new Date().toISOString(),
  });
  state.log(
    `Workflow "${definition.name}" completed with uncommitted changes in ${label.toLowerCase()}. Restarting for recovery: ${worktree.summary}`,
  );
  state.pbus.emit("runtime.restart_requested", {
    reason: `workflow "${definition.name}" completed with dirty ${restartReasonLabel(dirtyCheckout)}`,
    workflow: definition.name,
    runId: metadata.id,
  });
}
