import { nextActionForRecovery } from "#core/workflow/recovery-status.js";
import type {
  WorkflowRecoveryDirtyCheckout,
  WorkflowRecoveryState,
} from "#core/workflow/run-types.js";

type OperatorUiRecovery = Pick<
  WorkflowRecoveryState,
  "sourceWorkflow" | "sourceRunId" | "worktreeSummary" | "attempts"
> & {
  dirtyCheckout?: WorkflowRecoveryDirtyCheckout;
  nextAction?: string;
  status?: string;
};

export function recoveryIsUnavailable(recovery: OperatorUiRecovery): boolean {
  return recovery.status === "unavailable";
}

function dirtyCheckoutLabel(dirtyCheckout: WorkflowRecoveryDirtyCheckout | undefined): string {
  if (dirtyCheckout === undefined) return "worktree";
  return dirtyCheckout === "workspace" ? "workspace checkout" : "canonical checkout";
}

function recoveryNextAction(recovery: OperatorUiRecovery): string {
  return recovery.nextAction ?? nextActionForRecovery(recovery);
}

export function formatOperatorRecoverySummary(recovery: OperatorUiRecovery): string {
  const prefix = recoveryIsUnavailable(recovery)
    ? `git status unavailable for ${dirtyCheckoutLabel(recovery.dirtyCheckout)} recovery`
    : `dirty ${dirtyCheckoutLabel(recovery.dirtyCheckout)} recovery`;
  return (
    `${prefix} from ${recovery.sourceWorkflow} ` +
    `(${recovery.sourceRunId}, attempts ${recovery.attempts}): ` +
    `${recovery.worktreeSummary}; next: ${recoveryNextAction(recovery)}`
  );
}
