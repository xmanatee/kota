import { defineWorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";
import {
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
	return createMergeGateResolutionPhase({
		...state,
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

	const unresolvedMarkers = stageConflictPaths(state.workspaceDir, state.conflicts);
	if (unresolvedMarkers.length > 0) {
		const validation = runValidation(state.workspaceDir, state.validationCommand);
		return nextResolutionOrExhausted(state, unresolvedMarkers, validation);
	}

	const remaining = classifyConflicts(state.workspaceDir);
	const nextConflicts = remaining.length > 0 ? remaining : state.conflicts;
	if (remaining.length === 0) {
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
	}

	const validation = runValidation(state.workspaceDir, state.validationCommand);
	if (remaining.length === 0 && (!validation || validation.passed)) {
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
				resolutionAttempts: state.attempt,
			}),
		);
	}

	return nextResolutionOrExhausted(state, nextConflicts, validation);
}

export const continueMergeAutomationWorktreeOperation = defineWorkflowBlockingOperation<
	{ state: MergeGateResolutionState; resolution: MergeGateResolverResult },
	MergeGatePhaseResult
>(import.meta.url, "continueMergeAutomationWorktreeInWorker");
