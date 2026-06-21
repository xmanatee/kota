import { getRepoWorktreeStatus } from "#core/util/repo-worktree.js";
import type { WorkflowRunExecutionResult } from "./run-types.js";
import type { WorkflowRuntimeDispatchState } from "./runtime-dispatch.js";
import type { WorkflowDefinition } from "./types.js";

function pauseDispatchForDirtyWorktree(state: WorkflowRuntimeDispatchState): void {
  state.wfQueue.setRuns([]);
  state.wfQueue.persist();
  state.dispatchPaused = true;
}

export function handleDirtyCompletion(
  state: WorkflowRuntimeDispatchState,
  definition: WorkflowDefinition,
  metadata: WorkflowRunExecutionResult["metadata"],
  preRunFingerprint: string,
): void {
  const worktree = getRepoWorktreeStatus(state.projectDir);
  if (!worktree.available) return;

  if (!worktree.trackedDirty) {
    if (state.store.getRecovery()) {
      state.store.setRecovery(null);
    }
    return;
  }

  const existing = state.store.getRecovery();

  const otherActiveWorkflows = [...state.activeRuns.keys()]
    .filter((workflowName) => workflowName !== definition.name);
  if (otherActiveWorkflows.length > 0) {
    state.log(
      `Worktree dirty after "${definition.name}" while ${otherActiveWorkflows.join(", ")} still active - deferring attribution: ${worktree.summary}`,
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
        `Worktree still dirty after "${definition.name}" and recovery already owns the same fingerprint - dispatch paused: ${worktree.summary}`,
      );
      return;
    }
    state.store.setRecovery({
      sourceRunId: metadata.id,
      sourceWorkflow: definition.name,
      worktreeFingerprint: worktree.fingerprint,
      worktreeSummary: worktree.summary,
      attempts: 1,
      retryAttemptedBy: [{ workflow: definition.name, runId: metadata.id, attemptedAt }],
      updatedAt: attemptedAt,
    });
    pauseDispatchForDirtyWorktree(state);
    state.log(
      `Worktree was already dirty before "${definition.name}" and remained dirty - dispatch paused: ${worktree.summary}`,
    );
    return;
  }

  pauseDispatchForDirtyWorktree(state);
  if (existing && existing.attempts >= 1) {
    state.store.setRecovery({
      ...existing,
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
      `Recovery already attempted for dirty worktree left by "${existing.sourceWorkflow}" (${existing.sourceRunId}). Dispatch paused: ${worktree.summary}`,
    );
    return;
  }

  state.store.setRecovery({
    sourceRunId: metadata.id,
    sourceWorkflow: definition.name,
    worktreeFingerprint: worktree.fingerprint,
    worktreeSummary: worktree.summary,
    attempts: existing?.attempts ?? 0,
    retryAttemptedBy: existing?.retryAttemptedBy ?? [],
    updatedAt: new Date().toISOString(),
  });
  state.log(
    `Workflow "${definition.name}" completed with uncommitted changes. Restarting for recovery: ${worktree.summary}`,
  );
  state.pbus.emit("runtime.restart_requested", {
    reason: `workflow "${definition.name}" completed with dirty worktree`,
    workflow: definition.name,
    runId: metadata.id,
  });
}
