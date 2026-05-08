import { getRepoWorktreeStatus } from "#core/util/repo-worktree.js";
import type { WorkflowRunExecutionResult } from "./run-types.js";
import type { WorkflowRuntimeDispatchState } from "./runtime-dispatch.js";
import type { WorkflowDefinition } from "./types.js";

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

  if (worktree.fingerprint === preRunFingerprint) {
    if (existing) {
      state.store.setRecovery({
        ...existing,
        retryAttemptedBy: [
          ...existing.retryAttemptedBy,
          { workflow: definition.name, runId: metadata.id, attemptedAt: new Date().toISOString() },
        ],
        updatedAt: new Date().toISOString(),
      });
    }
    state.log(
      `Worktree still dirty after "${definition.name}" but fingerprint unchanged — not attributing: ${worktree.summary}`,
    );
    return;
  }

  state.wfQueue.setRuns([]);
  state.wfQueue.persist();
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
  state.dispatchPaused = true;
  state.log(
    `Workflow "${definition.name}" completed with uncommitted changes. Restarting for recovery: ${worktree.summary}`,
  );
  state.pbus.emit("runtime.restart_requested", {
    reason: `workflow "${definition.name}" completed with dirty worktree`,
    workflow: definition.name,
    runId: metadata.id,
  });
}
