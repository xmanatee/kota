import type {
  WorkflowRecoveryDirtyCheckout,
  WorkflowRecoveryRetryAttempt,
} from "./run-types.js";

export type WorkflowRecoveryStatus =
  | { status: "none"; clearedStale?: boolean }
  | {
      status: "pending";
      sourceRunId: string;
      sourceWorkflow: string;
      dirtyCheckout: WorkflowRecoveryDirtyCheckout;
      worktreeFingerprint: string;
      worktreeSummary: string;
      attempts: number;
      retryAttemptedBy: WorkflowRecoveryRetryAttempt[];
      updatedAt: string;
      nextAction: string;
    }
  | {
      status: "unavailable";
      sourceRunId: string;
      sourceWorkflow: string;
      dirtyCheckout: WorkflowRecoveryDirtyCheckout;
      worktreeFingerprint: string;
      worktreeSummary: string;
      attempts: number;
      retryAttemptedBy: WorkflowRecoveryRetryAttempt[];
      updatedAt: string;
      unavailableReason: string;
      nextAction: string;
    };

export type WorkflowDispatchPauseStatus =
  | { paused: false; kind: "none" }
  | {
      paused: true;
      kind: "operator";
      source: "signal";
      message: string;
      nextAction: string;
    }
  | {
      paused: true;
      kind: "runtime";
      source: "runtime";
      message: string;
      nextAction: string;
    }
  | {
      paused: true;
      kind: "dirty-recovery";
      source: "signal" | "runtime";
      message: string;
      nextAction: string;
      recovery: Exclude<WorkflowRecoveryStatus, { status: "none" }>;
    };
