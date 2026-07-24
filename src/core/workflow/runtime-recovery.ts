import { getRepoWorktreeStatus } from "#core/util/repo-worktree.js";
import {
  nextActionForRecovery,
  reconcileWorkflowRecovery,
  writeDirtyRecoveryPauseSignal,
} from "./recovery-status.js";
import type { WorkflowRecoveryDirtyCheckout } from "./run-types.js";
import { queueMatchingEventFirst, type WorkflowRuntimeEventsState } from "./runtime-events.js";
import type { WorkflowDefinition } from "./types.js";

export type WorkflowRuntimeRecoveryState = WorkflowRuntimeEventsState;

const recoveryFilter = (def: WorkflowDefinition): boolean => def.recoveryCapable;

function workspaceDirFor(state: WorkflowRuntimeRecoveryState): string {
  return state.workspaceDir ?? state.runtimeConfig.workspaceDir ?? state.projectDir;
}

function runtimeDirtyCheckout(
  state: WorkflowRuntimeRecoveryState,
): WorkflowRecoveryDirtyCheckout {
  return workspaceDirFor(state) === state.projectDir ? "canonical" : "workspace";
}

function recoveryWorktreeDir(
  state: WorkflowRuntimeRecoveryState,
  dirtyCheckout: WorkflowRecoveryDirtyCheckout,
): string {
  return dirtyCheckout === "workspace" ? workspaceDirFor(state) : state.projectDir;
}

function checkoutLabel(dirtyCheckout: WorkflowRecoveryDirtyCheckout): string {
  return dirtyCheckout === "workspace" ? "workspace checkout" : "canonical checkout";
}

/**
 * If the daemon recovered interrupted runs and the worktree is dirty, queue
 * `runtime.recovered` workflows ahead of the normal queue. Called from start
 * after `WorkflowRunStore.recoverInterruptedRuns()` returns the affected runs.
 */
export function queueInterruptedRunRecovery(
  state: WorkflowRuntimeRecoveryState,
  interrupted: Array<{ id: string; workflow: string }>,
): void {
  if (interrupted.length === 0) return;
  const dirtyCheckout = runtimeDirtyCheckout(state);
  const worktree = getRepoWorktreeStatus(recoveryWorktreeDir(state, dirtyCheckout));
  if (!worktree.available || !worktree.dirty) return;

  const queued = queueMatchingEventFirst(
    state,
    "runtime.recovered",
    {
      recoveredRunIds: interrupted.map((run) => run.id),
      recoveredWorkflows: interrupted.map((run) => run.workflow),
      recoveredAt: new Date().toISOString(),
      dirtyCheckout,
      worktreeSummary: worktree.summary,
    },
    recoveryFilter,
  );
  if (queued === 0) {
    state.log(
      `Recovered interrupted run(s) left a dirty ${checkoutLabel(dirtyCheckout)}, but no recovery-capable workflow matched runtime.recovered: ${worktree.summary}`,
    );
    return;
  }
  state.log(
    `Queued ${queued} recovery workflow${queued === 1 ? "" : "s"} for interrupted run(s) with uncommitted changes in ${checkoutLabel(dirtyCheckout)}: ${worktree.summary}`,
  );
}

/**
 * If the previous shutdown left a recovery record on disk, decide whether to
 * dispatch a fresh recovery attempt or pause dispatch entirely. The runtime
 * gives recovery exactly one retry — beyond that the worktree is paused for
 * operator attention.
 */
export function queueRecovery(state: WorkflowRuntimeRecoveryState): void {
  const recoveryStatus = reconcileWorkflowRecovery({
    projectDir: state.projectDir,
    workspaceDir: state.workspaceDir ?? state.runtimeConfig.workspaceDir,
    store: state.store,
  });
  if (recoveryStatus.status === "none") return;
  const dirtyCheckout = recoveryStatus.dirtyCheckout;

  if (recoveryStatus.status === "unavailable") {
    state.log(
      `Recovery pending for ${checkoutLabel(dirtyCheckout)}, but git status is unavailable: ${recoveryStatus.worktreeSummary}`,
    );
    return;
  }

  const refreshedRecovery = {
    sourceRunId: recoveryStatus.sourceRunId,
    sourceWorkflow: recoveryStatus.sourceWorkflow,
    dirtyCheckout,
    worktreeFingerprint: recoveryStatus.worktreeFingerprint,
    worktreeSummary: recoveryStatus.worktreeSummary,
    attempts: recoveryStatus.attempts,
    retryAttemptedBy: recoveryStatus.retryAttemptedBy,
    updatedAt: new Date().toISOString(),
  };

  if (recoveryStatus.attempts >= 1) {
    state.store.setRecovery(refreshedRecovery);
    pauseDispatch(
      state,
      `Recovery exhausted after a failed recovery attempt from "${recoveryStatus.sourceWorkflow}" (${recoveryStatus.sourceRunId}): ${recoveryStatus.worktreeSummary}`,
      {
        ...recoveryStatus,
        updatedAt: refreshedRecovery.updatedAt,
      },
    );
    return;
  }

  state.store.setRecovery({
    ...refreshedRecovery,
    attempts: recoveryStatus.attempts + 1,
  });
  const queued = queueMatchingEventFirst(
    state,
    "runtime.recovered",
    {
      recoveredAt: new Date().toISOString(),
      sourceRunId: recoveryStatus.sourceRunId,
      sourceWorkflow: recoveryStatus.sourceWorkflow,
      dirtyCheckout,
      worktreeSummary: recoveryStatus.worktreeSummary,
    },
    recoveryFilter,
  );
  if (queued === 0) {
    pauseDispatch(
      state,
      `Recovery pending for dirty ${checkoutLabel(dirtyCheckout)}, but no recovery-capable workflow matched runtime.recovered: ${recoveryStatus.worktreeSummary}`,
      {
        ...recoveryStatus,
        attempts: recoveryStatus.attempts + 1,
        nextAction: nextActionForRecovery({ attempts: recoveryStatus.attempts + 1 }),
        updatedAt: refreshedRecovery.updatedAt,
      },
    );
    return;
  }
  state.log(
    `Queued ${queued} recovery workflow${queued === 1 ? "" : "s"} for dirty ${checkoutLabel(dirtyCheckout)} left by "${recoveryStatus.sourceWorkflow}" (${recoveryStatus.sourceRunId}): ${recoveryStatus.worktreeSummary}`,
  );
}

function pauseDispatch(
  state: WorkflowRuntimeRecoveryState,
  reason: string,
  recoveryStatus: Exclude<ReturnType<typeof reconcileWorkflowRecovery>, { status: "none" }>,
): void {
  state.dispatchPaused = true;
  state.wfQueue.setRuns([]);
  state.wfQueue.persist();
  writeDirtyRecoveryPauseSignal(state.projectDir, recoveryStatus);
  state.log(reason);
}
