import type {
  AutomationWorktreeCanonicalConflict,
  AutomationWorktreeCanonicalReconciliation,
  AutomationWorktreeCanonicalValidation,
  AutomationWorktreeSelector,
} from "./worktree-lifecycle-types.js";
import {
  captureMergeIndexSnapshot,
  type MergeIndexSnapshot,
} from "./worktree-merge-gate-finalize.js";
import {
  canonicalConflictDiff,
  currentHead,
} from "./worktree-merge-gate-support.js";
import type {
  MergeGateResolutionReview,
  MergeGateResolverRequest,
} from "./worktree-merge-gate-types.js";

export type CanonicalReconciliationOperationInput =
  AutomationWorktreeSelector & {
    recoveryRunId: string;
    artifactPath: string;
    validationCommands: readonly (readonly string[])[];
    maxResolutionAttempts: number;
  };

export type CanonicalReconciliationResolutionState = {
  input: CanonicalReconciliationOperationInput;
  record: AutomationWorktreeCanonicalReconciliation;
  workspaceDir: string;
  branch: string;
  canonicalHeadCommit: string;
  destructivePaths: string[];
  conflicts: AutomationWorktreeCanonicalConflict[];
  validations: AutomationWorktreeCanonicalValidation[];
  previousValidation: AutomationWorktreeCanonicalValidation | null;
  previousReview?: MergeGateResolutionReview;
  attempt: number;
  beforeResolver: MergeIndexSnapshot;
};

export type CanonicalReconciliationPhaseResult =
  | {
      kind: "complete";
      record: AutomationWorktreeCanonicalReconciliation;
      progress: AutomationWorktreeCanonicalReconciliation[];
    }
  | {
      kind: "resolve";
      state: CanonicalReconciliationResolutionState;
      request: MergeGateResolverRequest;
      progress: AutomationWorktreeCanonicalReconciliation[];
    };

export function completeCanonicalReconciliation(
  record: AutomationWorktreeCanonicalReconciliation,
  progress: AutomationWorktreeCanonicalReconciliation[] = [],
): CanonicalReconciliationPhaseResult {
  return { kind: "complete", record, progress };
}

export function createCanonicalReconciliationResolutionPhase(
  input: Omit<CanonicalReconciliationResolutionState, "beforeResolver">,
  progress: AutomationWorktreeCanonicalReconciliation[] = [],
): CanonicalReconciliationPhaseResult {
  const beforeResolver = captureMergeIndexSnapshot(input.workspaceDir);
  return {
    kind: "resolve",
    state: { ...input, beforeResolver },
    request: {
      taskId: input.input.taskId,
      workspaceDir: input.workspaceDir,
      branch: input.branch,
      baseCommit: input.record.originalBaseCommit,
      canonicalHeadCommit: input.canonicalHeadCommit,
      headCommit: currentHead(input.workspaceDir),
      canonicalDiff: canonicalConflictDiff(
        input.workspaceDir,
        input.record.originalBaseCommit,
        input.canonicalHeadCommit,
        input.conflicts,
      ),
      attempt: input.attempt,
      conflicts: input.conflicts,
      previousValidation: input.previousValidation,
      ...(input.previousReview !== undefined
        ? { previousReview: input.previousReview }
        : {}),
    },
    progress,
  };
}
