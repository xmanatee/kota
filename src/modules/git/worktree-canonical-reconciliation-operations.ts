import { defineWorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";
import { checkpointPreservedAutomationWorktree } from "./worktree-canonical-reconciliation-checkpoint.js";
import {
  type CanonicalReconciliationOperationInput,
  type CanonicalReconciliationPhaseResult,
  type CanonicalReconciliationResolutionState,
  completeCanonicalReconciliation,
  createCanonicalReconciliationResolutionPhase,
} from "./worktree-canonical-reconciliation-operation-types.js";
import {
  blockReconciliation,
  boundedActualConflicts,
  branchBehind,
  type CheckpointAndReconcileAutomationWorktreeInput,
  canonicalDestructivePaths,
  changedPaths,
  hasUnresolvableBoundedConflict,
  resurrectedDestructivePaths,
  runReconciliationValidations,
  updateReconciliationRecord,
} from "./worktree-canonical-reconciliation-support.js";
import { readDirtyState } from "./worktree-lifecycle-support.js";
import type {
  AutomationWorktreeCanonicalConflict,
  AutomationWorktreeCanonicalReconciliation,
  AutomationWorktreeCanonicalValidation,
} from "./worktree-lifecycle-types.js";
import {
  boundedSemanticReviewRetry,
  commitResolvedMerge,
  stageConflictPaths,
  validateResolvedMergeBoundary,
} from "./worktree-merge-gate-finalize.js";
import {
  classifyConflicts,
  conflictMarkerConflicts,
  currentHead,
  isAncestor,
  runGit,
} from "./worktree-merge-gate-support.js";
import type { MergeGateResolverResult } from "./worktree-merge-gate-types.js";

function supportInput(
  input: CanonicalReconciliationOperationInput,
  progress: AutomationWorktreeCanonicalReconciliation[],
): CheckpointAndReconcileAutomationWorktreeInput {
  return {
    ...input,
    onProgress: (record) => {
      progress.push(record);
    },
  };
}

function block(
  input: CanonicalReconciliationOperationInput,
  record: AutomationWorktreeCanonicalReconciliation,
  reason: string,
  conflicts?: AutomationWorktreeCanonicalConflict[],
  progress: AutomationWorktreeCanonicalReconciliation[] = [],
): CanonicalReconciliationPhaseResult {
  return completeCanonicalReconciliation(
    blockReconciliation(supportInput(input, progress), record, reason, conflicts),
    progress,
  );
}

function update(
  input: CanonicalReconciliationOperationInput,
  record: AutomationWorktreeCanonicalReconciliation,
  changes: Partial<AutomationWorktreeCanonicalReconciliation>,
  progress: AutomationWorktreeCanonicalReconciliation[],
): AutomationWorktreeCanonicalReconciliation {
  return updateReconciliationRecord(supportInput(input, progress), record, changes);
}

function validationFailureReason(
  validation: AutomationWorktreeCanonicalValidation,
): string {
  const exit = validation.exitCode === null
    ? "unknown exit"
    : `exit ${validation.exitCode}`;
  return `canonical reconciliation validation failed: ${validation.command.join(" ")} (${exit})`;
}

function finishReconciliation(
  state: Pick<
    CanonicalReconciliationResolutionState,
    "input" | "record" | "workspaceDir" | "canonicalHeadCommit" | "validations"
  >,
  currentTreeValidated: boolean,
  progress: AutomationWorktreeCanonicalReconciliation[],
): CanonicalReconciliationPhaseResult {
  const validations = currentTreeValidated
    ? state.validations
    : runReconciliationValidations(
        state.workspaceDir,
        state.input.validationCommands,
      );
  const failed = validations.find((validation) => !validation.passed);
  if (failed) {
    return block(
      state.input,
      { ...state.record, validations },
      validationFailureReason(failed),
      [],
      progress,
    );
  }
  if (currentHead(state.input.projectDir) !== state.canonicalHeadCommit) {
    return block(
      state.input,
      { ...state.record, validations },
      "canonical checkout advanced during preserved recovery reconciliation",
      undefined,
      progress,
    );
  }
  const headCommit = currentHead(state.workspaceDir);
  const behindAtResume = branchBehind(
    state.workspaceDir,
    headCommit,
    state.canonicalHeadCommit,
  );
  if (behindAtResume !== 0) {
    return block(
      state.input,
      { ...state.record, validations },
      "reconciled worktree still trails the captured canonical head",
      undefined,
      progress,
    );
  }
  return completeCanonicalReconciliation(
    update(state.input, state.record, {
      phase: "ready-to-resume",
      disposition: "ready-to-resume",
      integratedCanonicalHeadCommit: state.canonicalHeadCommit,
      branchBehindAtResume: behindAtResume,
      conflicts: [],
      validations,
      reason: null,
    }, progress),
    progress,
  );
}

function resolutionPhase(
  input: CanonicalReconciliationOperationInput,
  record: AutomationWorktreeCanonicalReconciliation,
  workspaceDir: string,
  branch: string,
  canonicalHeadCommit: string,
  destructivePaths: string[],
  conflicts: AutomationWorktreeCanonicalConflict[],
  progress: AutomationWorktreeCanonicalReconciliation[],
): CanonicalReconciliationPhaseResult {
  return createCanonicalReconciliationResolutionPhase({
    input,
    record,
    workspaceDir,
    branch,
    canonicalHeadCommit,
    destructivePaths,
    conflicts,
    validations: [],
    previousValidation: null,
    attempt: 1,
  }, progress);
}

function reconcileCanonicalHead(
  input: CanonicalReconciliationOperationInput,
  record: AutomationWorktreeCanonicalReconciliation,
  workspaceDir: string,
  branch: string,
  canonicalHeadCommit: string,
  destructivePaths: string[],
  progress: AutomationWorktreeCanonicalReconciliation[],
): CanonicalReconciliationPhaseResult {
  if (isAncestor(workspaceDir, canonicalHeadCommit, currentHead(workspaceDir))) {
    return finishReconciliation(
      {
        input,
        record,
        workspaceDir,
        canonicalHeadCommit,
        validations: record.validations,
      },
      false,
      progress,
    );
  }
  const merge = runGit(workspaceDir, [
    "merge",
    "--no-ff",
    "--no-commit",
    canonicalHeadCommit,
  ]);
  if (!merge.ok) {
    const conflicts = boundedActualConflicts(
      classifyConflicts(workspaceDir),
      new Set(destructivePaths),
    );
    if (conflicts.length === 0) {
      return block(
        input,
        record,
        merge.stderr ||
          merge.stdout ||
          "canonical merge failed without classified conflicts",
        undefined,
        progress,
      );
    }
    if (hasUnresolvableBoundedConflict(conflicts, new Set(destructivePaths))) {
      return block(
        input,
        record,
        "canonical merge contains binary, generated, rename, or structural conflicts outside canonical destructive paths",
        conflicts,
        progress,
      );
    }
    return resolutionPhase(
      input,
      record,
      workspaceDir,
      branch,
      canonicalHeadCommit,
      destructivePaths,
      conflicts,
      progress,
    );
  }
  const resurrected = resurrectedDestructivePaths(
    workspaceDir,
    destructivePaths,
  );
  if (resurrected.length > 0) {
    return block(
      input,
      record,
      "clean canonical merge would resurrect deleted or renamed paths",
      resurrected.map((path) => ({
        path,
        kind: "blocked-path",
        reason: "canonical deletion or rename must remain authoritative",
      })),
      progress,
    );
  }
  const validations = runReconciliationValidations(
    workspaceDir,
    input.validationCommands,
  );
  const failed = validations.find((validation) => !validation.passed);
  if (failed) {
    return block(
      input,
      { ...record, validations },
      validationFailureReason(failed),
      [],
      progress,
    );
  }
  const committed = commitResolvedMerge(workspaceDir, branch);
  if (!committed.ok) {
    return block(input, record, committed.reason, undefined, progress);
  }
  return finishReconciliation(
    {
      input,
      record: { ...record, validations },
      workspaceDir,
      canonicalHeadCommit,
      validations,
    },
    true,
    progress,
  );
}

export function prepareCanonicalReconciliationInWorker(
  input: CanonicalReconciliationOperationInput,
): CanonicalReconciliationPhaseResult {
  const progress: AutomationWorktreeCanonicalReconciliation[] = [];
  const prepared = checkpointPreservedAutomationWorktree(supportInput(input, progress));
  if (!prepared.ready) return completeCanonicalReconciliation(prepared.record, progress);
  const {
    inspection,
    workspaceDir,
    checkpointCommit,
    preservedPaths,
    existingMergeHead,
  } = prepared;
  let record = prepared.record;
  const canonicalHeadCommit = currentHead(input.projectDir);
  if (canonicalHeadCommit !== record.canonicalHeadCommit) {
    const canonicalPaths = changedPaths(
      workspaceDir,
      inspection.metadata.baseCommit,
      canonicalHeadCommit,
    );
    const canonicalPathSet = new Set(canonicalPaths);
    record = update(input, record, {
      canonicalHeadCommit,
      branchBehindAtStart: branchBehind(
        workspaceDir,
        checkpointCommit,
        canonicalHeadCommit,
      ),
      overlappingPaths: preservedPaths.filter((path) =>
        canonicalPathSet.has(path)
      ),
      canonicalDestructivePaths: canonicalDestructivePaths(
        workspaceDir,
        inspection.metadata.baseCommit,
        canonicalHeadCommit,
      ),
    }, progress);
  }
  const destructivePaths = record.canonicalDestructivePaths;
  const canonicalDirty = readDirtyState(input.projectDir);
  if (canonicalDirty.trackedDirty || canonicalDirty.untracked) {
    return block(
      input,
      record,
      `canonical checkout is dirty before recovery reconciliation: ${canonicalDirty.entries.join(", ")}`,
      undefined,
      progress,
    );
  }

  if (existingMergeHead !== null) {
    if (!isAncestor(workspaceDir, existingMergeHead, canonicalHeadCommit)) {
      return block(
        input,
        record,
        "pending merge head is not an ancestor of the current canonical head",
        undefined,
        progress,
      );
    }
    const conflicts = boundedActualConflicts(
      classifyConflicts(workspaceDir),
      new Set(destructivePaths),
    );
    if (conflicts.length === 0) {
      return block(
        input,
        record,
        "pending merge has no classified conflict paths",
        undefined,
        progress,
      );
    }
    if (hasUnresolvableBoundedConflict(conflicts, new Set(destructivePaths))) {
      return block(
        input,
        record,
        "pending canonical merge contains binary, generated, rename, or structural conflicts outside canonical destructive paths",
        conflicts,
        progress,
      );
    }
    return resolutionPhase(
      input,
      record,
      workspaceDir,
      inspection.branch,
      existingMergeHead,
      canonicalDestructivePaths(
        workspaceDir,
        record.originalBaseCommit,
        existingMergeHead,
      ),
      conflicts,
      progress,
    );
  }

  return reconcileCanonicalHead(
    input,
    record,
    workspaceDir,
    inspection.branch,
    canonicalHeadCommit,
    destructivePaths,
    progress,
  );
}

function nextResolution(
  state: CanonicalReconciliationResolutionState,
  updates: {
    conflicts?: AutomationWorktreeCanonicalConflict[];
    validations?: AutomationWorktreeCanonicalValidation[];
    previousValidation?: AutomationWorktreeCanonicalValidation | null;
    previousReview?: CanonicalReconciliationResolutionState["previousReview"];
  },
  progress: AutomationWorktreeCanonicalReconciliation[],
): CanonicalReconciliationPhaseResult {
  if (state.attempt >= state.input.maxResolutionAttempts) {
    return block(
      state.input,
      { ...state.record, validations: updates.validations ?? state.validations },
      "merge resolver exhausted bounded attempts",
      updates.conflicts ?? state.conflicts,
      progress,
    );
  }
  const { beforeResolver: _beforeResolver, ...nextState } = state;
  return createCanonicalReconciliationResolutionPhase({
    ...nextState,
    ...updates,
    attempt: state.attempt + 1,
  }, progress);
}

export function continueCanonicalReconciliationInWorker(input: {
  state: CanonicalReconciliationResolutionState;
  resolution: MergeGateResolverResult;
}): CanonicalReconciliationPhaseResult {
  const { state, resolution } = input;
  const progress: AutomationWorktreeCanonicalReconciliation[] = [];
  if (!resolution.resolved) {
    const retry = boundedSemanticReviewRetry({
      workspaceDir: state.workspaceDir,
      beforeResolver: state.beforeResolver,
      allowedConflictPaths: state.conflicts.map((conflict) => conflict.path),
      resolution,
      attempt: state.attempt,
      maxAttempts: state.input.maxResolutionAttempts,
    });
    if (retry.kind === "blocked") {
      return block(
        state.input,
        state.record,
        retry.violation.reason,
        retry.violation.conflicts,
        progress,
      );
    }
    if (retry.kind === "retry") {
      return nextResolution(state, { previousReview: retry.review }, progress);
    }
    return block(
      state.input,
      state.record,
      resolution.summary || "merge resolver did not resolve conflicts",
      state.conflicts,
      progress,
    );
  }

  const unresolved = conflictMarkerConflicts(
    state.workspaceDir,
    state.conflicts,
  );
  if (unresolved.length > 0) {
    return nextResolution(state, { conflicts: unresolved }, progress);
  }
  const boundaryViolation = validateResolvedMergeBoundary(state.workspaceDir, {
    beforeResolver: state.beforeResolver,
    allowedConflictPaths: state.conflicts.map((conflict) => conflict.path),
  });
  if (boundaryViolation) {
    return block(
      state.input,
      state.record,
      boundaryViolation.reason,
      boundaryViolation.conflicts,
      progress,
    );
  }
  const resurrected = resurrectedDestructivePaths(
    state.workspaceDir,
    state.destructivePaths,
  );
  if (resurrected.length > 0) {
    return block(
      state.input,
      state.record,
      "resolved merge would resurrect paths deleted or renamed on canonical",
      resurrected.map((path) => ({
        path,
        kind: "blocked-path",
        reason: "canonical deletion or rename must remain authoritative",
      })),
      progress,
    );
  }
  const validations = runReconciliationValidations(
    state.workspaceDir,
    state.input.validationCommands,
  );
  const failed = validations.find((validation) => !validation.passed);
  if (failed) {
    return nextResolution(state, {
      validations,
      previousValidation: failed,
    }, progress);
  }
  stageConflictPaths(state.workspaceDir, state.conflicts);
  const remaining = classifyConflicts(state.workspaceDir);
  if (remaining.length > 0) {
    return nextResolution(state, { conflicts: remaining, validations }, progress);
  }
  const committed = commitResolvedMerge(state.workspaceDir, state.branch);
  if (!committed.ok) {
    return block(state.input, state.record, committed.reason, undefined, progress);
  }
  if (state.record.canonicalHeadCommit !== state.canonicalHeadCommit) {
    return reconcileCanonicalHead(
      state.input,
      { ...state.record, validations },
      state.workspaceDir,
      state.branch,
      state.record.canonicalHeadCommit,
      state.record.canonicalDestructivePaths,
      progress,
    );
  }
  return finishReconciliation(
    { ...state, record: { ...state.record, validations }, validations },
    true,
    progress,
  );
}

export function blockCanonicalResolutionInWorker(input: {
  state: CanonicalReconciliationResolutionState;
  reason: string;
}): CanonicalReconciliationPhaseResult {
  const progress: AutomationWorktreeCanonicalReconciliation[] = [];
  return block(
    input.state.input,
    input.state.record,
    input.reason,
    input.state.conflicts,
    progress,
  );
}

export const prepareCanonicalReconciliationOperation =
  defineWorkflowBlockingOperation<
    CanonicalReconciliationOperationInput,
    CanonicalReconciliationPhaseResult
  >(import.meta.url, "prepareCanonicalReconciliationInWorker");

export const continueCanonicalReconciliationOperation =
  defineWorkflowBlockingOperation<
    {
      state: CanonicalReconciliationResolutionState;
      resolution: MergeGateResolverResult;
    },
    CanonicalReconciliationPhaseResult
  >(import.meta.url, "continueCanonicalReconciliationInWorker");

export const blockCanonicalResolutionOperation =
  defineWorkflowBlockingOperation<
    { state: CanonicalReconciliationResolutionState; reason: string },
    CanonicalReconciliationPhaseResult
  >(import.meta.url, "blockCanonicalResolutionInWorker");
