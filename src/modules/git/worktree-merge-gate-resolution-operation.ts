import { defineWorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";
import { resurrectedDestructivePaths } from "./worktree-canonical-reconciliation-support.js";
import {
  boundedSemanticReviewRetry,
  commitResolvedMerge,
  stageConflictPaths,
	validateAndFastForwardCanonical,
	validateResolvedMergeBoundary,
} from "./worktree-merge-gate-finalize.js";
import {
	completeMergeGatePhase,
	createMergeGateResolutionPhase,
	type MergeGatePhaseResult,
	type MergeGateResolutionState,
} from "./worktree-merge-gate-operation-types.js";
import { pendingBlocked } from "./worktree-merge-gate-results.js";
import {
  classifyConflicts,
  conflictMarkerConflicts,
  currentHead,
	pending,
	runValidation,
} from "./worktree-merge-gate-support.js";
import type {
	MergeGateConflict,
	MergeGateResolverResult,
	MergeGateValidation,
} from "./worktree-merge-gate-types.js";

function nextResolutionOrExhausted(
	state: MergeGateResolutionState,
	conflicts: MergeGateConflict[],
	validation: MergeGateValidation | null,
): MergeGatePhaseResult {
	if (state.attempt >= state.maxResolutionAttempts) {
		return completeMergeGatePhase(
			pendingBlocked(state.selector, {
				branch: state.branch,
				baseCommit: state.baseCommit,
				canonicalHeadCommit: state.canonicalHeadCommit,
				headCommit: currentHead(state.workspaceDir),
				reason: "merge resolver exhausted bounded attempts",
				conflicts,
				resolutionAttempts: state.maxResolutionAttempts,
				validation,
			}),
		);
	}
	const { beforeResolver: _beforeResolver, ...nextState } = state;
	return createMergeGateResolutionPhase({
		...nextState,
		conflicts,
		validation,
		attempt: state.attempt + 1,
	});
}

export function continueMergeAutomationWorktreeInWorker(input: {
	state: MergeGateResolutionState;
	resolution: MergeGateResolverResult;
}): MergeGatePhaseResult {
  const { state, resolution } = input;
  if (!resolution.resolved) {
    const reviewRetry = boundedSemanticReviewRetry({
      workspaceDir: state.workspaceDir,
      beforeResolver: state.beforeResolver,
      allowedConflictPaths: state.conflicts.map((conflict) => conflict.path),
      resolution,
      attempt: state.attempt,
      maxAttempts: state.maxResolutionAttempts,
    });
    if (reviewRetry.kind === "blocked") {
      return completeMergeGatePhase(
        pendingBlocked(state.selector, {
          branch: state.branch,
          baseCommit: state.baseCommit,
          canonicalHeadCommit: state.canonicalHeadCommit,
          headCommit: currentHead(state.workspaceDir),
          reason: reviewRetry.violation.reason,
          conflicts: reviewRetry.violation.conflicts,
          resolutionAttempts: state.attempt,
          validation: null,
        }),
      );
    }
    if (reviewRetry.kind === "retry") {
      return nextResolutionOrExhausted(
        { ...state, previousReview: reviewRetry.review },
        state.conflicts,
        state.validation,
      );
    }
    return completeMergeGatePhase(
			pending(state.selector, {
				branch: state.branch,
				baseCommit: state.baseCommit,
				canonicalHeadCommit: state.canonicalHeadCommit,
				headCommit: currentHead(state.workspaceDir),
				reason: resolution.summary || "merge resolver did not resolve conflicts",
				conflicts: state.conflicts,
				resolutionAttempts: state.attempt,
				validation: state.validation,
			}),
		);
	}

  const unresolvedMarkers = conflictMarkerConflicts(
    state.workspaceDir,
    state.conflicts,
  );
	if (unresolvedMarkers.length > 0) {
		const validation = runValidation(state.workspaceDir, state.validationCommand);
		return nextResolutionOrExhausted(state, unresolvedMarkers, validation);
	}

	const boundaryViolation = validateResolvedMergeBoundary(state.workspaceDir, {
		beforeResolver: state.beforeResolver,
		allowedConflictPaths: state.conflicts.map((conflict) => conflict.path),
	});
	if (boundaryViolation) {
		return completeMergeGatePhase(
			pendingBlocked(state.selector, {
				branch: state.branch,
				baseCommit: state.baseCommit,
				canonicalHeadCommit: state.canonicalHeadCommit,
				headCommit: currentHead(state.workspaceDir),
				reason: boundaryViolation.reason,
				conflicts: boundaryViolation.conflicts,
				resolutionAttempts: state.attempt,
				validation: null,
			}),
		);
	}
	const resurrected = resurrectedDestructivePaths(
		state.workspaceDir,
		state.destructivePaths,
	);
	if (resurrected.length > 0) {
		return completeMergeGatePhase(
			pendingBlocked(state.selector, {
				branch: state.branch,
				baseCommit: state.baseCommit,
				canonicalHeadCommit: state.canonicalHeadCommit,
				headCommit: currentHead(state.workspaceDir),
				reason: "resolved merge would resurrect paths deleted or renamed on canonical",
				conflicts: resurrected.map((path) => ({
					path,
					kind: "blocked-path",
					reason: "canonical deletion or rename must remain authoritative",
				})),
				resolutionAttempts: state.attempt,
				validation: null,
			}),
		);
	}

	const validation = runValidation(state.workspaceDir, state.validationCommand);
	if (!validation || validation.passed) {
		stageConflictPaths(state.workspaceDir, state.conflicts);
		const remaining = classifyConflicts(state.workspaceDir);
		if (remaining.length > 0) {
			return nextResolutionOrExhausted(state, remaining, validation);
		}
		const commit = commitResolvedMerge(state.workspaceDir, state.branch);
		if (!commit.ok) {
			return completeMergeGatePhase(
				pendingBlocked(state.selector, {
					branch: state.branch,
					baseCommit: state.baseCommit,
					canonicalHeadCommit: state.canonicalHeadCommit,
					headCommit: currentHead(state.workspaceDir),
					reason: commit.reason,
					conflicts: [],
					resolutionAttempts: state.attempt,
					validation,
				}),
			);
		}
		return completeMergeGatePhase(
			validateAndFastForwardCanonical(state.selector, {
				branch: state.branch,
				baseCommit: state.baseCommit,
				canonicalHeadCommit: state.canonicalHeadCommit,
				validationCommand: state.validationCommand,
				validation,
				resolutionAttempts: state.attempt,
			}),
		);
	}

	return nextResolutionOrExhausted(state, state.conflicts, validation);
}

export const continueMergeAutomationWorktreeOperation = defineWorkflowBlockingOperation<
	{ state: MergeGateResolutionState; resolution: MergeGateResolverResult },
	MergeGatePhaseResult
>(import.meta.url, "continueMergeAutomationWorktreeInWorker");
