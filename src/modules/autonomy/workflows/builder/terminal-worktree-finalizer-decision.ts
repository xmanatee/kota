import type {
  WorkflowRepairContinuationDecisionKind,
  WorkflowRunMetadata,
} from "#core/workflow/run-types.js";
import { BUILDER_RECOVERY_EVENT } from "./recovery-continuation.js";

export type BuilderTerminalClaimDisposition =
  | "preserved"
  | "pending-decomposition"
  | "released"
  | "already-absent"
  | "conflict";

export type BuilderTerminalRecoveryAction =
  | {
      kind: "none";
      reason: string;
    }
  | {
      kind: "continuation-requested";
      reason: string;
    }
  | {
      kind: "decomposition-pending";
      reason: string;
    }
  | {
      kind: "priority-yield";
      reason: string;
    }
  | {
      kind: "owner-decision-required";
      reason: string;
    }
  | {
      kind: "state-recovery-required";
      reason: string;
      inspectCommand: string;
      resolveCommand: string;
    };

export function builderStateRecoveryAction(
  taskId: string,
  reason: string,
): BuilderTerminalRecoveryAction {
  return {
    kind: "state-recovery-required",
    reason,
    inspectCommand: "pnpm kota workflow state-recovery list",
    resolveCommand:
      `pnpm kota workflow state-recovery resolve ${taskId} ` +
      '--action <release|supersede> --reason "<reason>"',
  };
}

export function builderTerminalRecoveryAction(input: {
  triggerEvent: string;
  taskId: string;
  removed: boolean;
  recoveryRequested: boolean;
  claimDisposition: BuilderTerminalClaimDisposition;
  continuationDecision: WorkflowRepairContinuationDecisionKind | null;
}): BuilderTerminalRecoveryAction {
  if (input.continuationDecision === "preserve-yield") {
    return {
      kind: "priority-yield",
      reason:
        "builder work was deliberately preserved; dispatcher priority decides when it resumes",
    };
  }
  if (input.continuationDecision === "needs-owner") {
    return {
      kind: "owner-decision-required",
      reason:
        "builder work remains claim-held pending the recorded owner decision",
    };
  }
  if (input.claimDisposition === "conflict") {
    return builderStateRecoveryAction(
      input.taskId,
      "terminal builder worktree was removed but its task claim changed ownership",
    );
  }
  if (input.claimDisposition === "pending-decomposition") {
    return {
      kind: "decomposition-pending",
      reason: "exhausted builder task is reserved until decomposer dispositions it",
    };
  }
  if (input.removed) {
    return { kind: "none", reason: "terminal builder worktree was removed" };
  }
  if (input.recoveryRequested) {
    return {
      kind: "continuation-requested",
      reason: "one automatic preserved-work continuation was requested",
    };
  }
  if (input.triggerEvent !== BUILDER_RECOVERY_EVENT) {
    return {
      kind: "none",
      reason: "terminal builder worktree awaits the normal recovery scan",
    };
  }
  return builderStateRecoveryAction(
    input.taskId,
    "preserved builder continuation needs recovery review",
  );
}

export function continuationDecisionFromMetadata(
  metadata: WorkflowRunMetadata,
): WorkflowRepairContinuationDecisionKind | null {
  const output = metadata.steps.find((step) => step.id === "build")?.output as
    | {
        continuationDecisions?: Array<{
          decision?: WorkflowRepairContinuationDecisionKind;
        }>;
      }
    | undefined;
  const decision = output?.continuationDecisions?.at(-1)?.decision;
  return decision === "continue" ||
    decision === "decompose" ||
    decision === "preserve-yield" ||
    decision === "needs-owner"
    ? decision
    : null;
}
