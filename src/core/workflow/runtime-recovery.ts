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
 * Queue recovery for interrupted runs ahead of normal work. Recovery remains
 * owned by the interrupted workflows even when their checkout is dirty; other
 * recovery-capable workflows must not mutate or preserve state they did not
 * create.
 */
export function queueInterruptedRunRecovery(
  state: WorkflowRuntimeRecoveryState,
  interrupted: Array<{ id: string; workflow: string }>,
): void {
  if (interrupted.length === 0) return;
  const dirtyCheckout = runtimeDirtyCheckout(state);
  const worktree = getRepoWorktreeStatus(recoveryWorktreeDir(state, dirtyCheckout));
  const broadRecovery = worktree.available && worktree.dirty;
  const interruptedWorkflows = new Set(interrupted.map((run) => run.workflow));
  const definitionFilter = (definition: WorkflowDefinition) =>
    recoveryFilter(definition) && interruptedWorkflows.has(definition.name);

  const queued = queueMatchingEventFirst(
    state,
    "runtime.recovered",
    {
      recoveredRunIds: interrupted.map((run) => run.id),
      recoveredWorkflows: interrupted.map((run) => run.workflow),
      recoveredAt: new Date().toISOString(),
      ...(broadRecovery ? { dirtyCheckout, worktreeSummary: worktree.summary } : {}),
    },
    definitionFilter,
  );
  if (queued === 0) {
    if (broadRecovery) {
      state.log(
        `Recovered interrupted run(s) left a dirty ${checkoutLabel(dirtyCheckout)}, but no recovery-capable workflow matched runtime.recovered: ${worktree.summary}`,
      );
    }
    return;
  }
  const scope = broadRecovery
    ? `interrupted run(s) with uncommitted changes in ${checkoutLabel(dirtyCheckout)}: ${worktree.summary}`
    : "interrupted recovery-capable workflow run(s)";
  state.log(`Queued ${queued} recovery workflow${queued === 1 ? "" : "s"} for ${scope}`);
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
    (definition) =>
      recoveryFilter(definition) &&
      definition.name === recoveryStatus.sourceWorkflow,
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
  state.wfQueue.persist();
  writeDirtyRecoveryPauseSignal(state.projectDir, recoveryStatus);
  state.log(reason);
}
