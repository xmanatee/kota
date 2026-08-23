import type { AutomationWorktreeSelector } from "./worktree-lifecycle-types.js";
import {
	commitResolvedMerge,
	validateAndFastForwardCanonical,
} from "./worktree-merge-gate-finalize.js";
import { currentHead, pending, runValidation } from "./worktree-merge-gate-support.js";
import type {
	MergeGateConflict,
	MergeGateResult,
	MergeGateValidation,
} from "./worktree-merge-gate-types.js";

export function pendingBlocked(
	selector: AutomationWorktreeSelector,
	input: {
		branch: string;
		baseCommit: string;
		canonicalHeadCommit: string;
		headCommit: string;
		reason: string;
		conflicts?: MergeGateConflict[];
		validation?: MergeGateValidation | null;
		resolutionAttempts?: number;
	},
): MergeGateResult {
	return pending(selector, {
		branch: input.branch,
		baseCommit: input.baseCommit,
		canonicalHeadCommit: input.canonicalHeadCommit,
		headCommit: input.headCommit,
		reason: input.reason,
		conflicts: input.conflicts ?? [],
		resolutionAttempts: input.resolutionAttempts ?? 0,
		validation: input.validation ?? null,
		status: "blocked",
	});
}

export function finishCleanMerge(
	selector: AutomationWorktreeSelector,
	input: {
		branch: string;
		baseCommit: string;
		canonicalHeadCommit: string;
		workspaceDir: string;
		validationCommand: readonly string[] | undefined;
	},
): MergeGateResult {
	const validation = runValidation(input.workspaceDir, input.validationCommand);
	if (validation && !validation.passed) {
		return pendingBlocked(selector, {
			branch: input.branch,
			baseCommit: input.baseCommit,
			canonicalHeadCommit: input.canonicalHeadCommit,
			headCommit: currentHead(input.workspaceDir),
			reason: "validation failed after clean merge",
			validation,
		});
	}
	const commit = commitResolvedMerge(input.workspaceDir, input.branch);
	if (!commit.ok) {
		return pendingBlocked(selector, {
			branch: input.branch,
			baseCommit: input.baseCommit,
			canonicalHeadCommit: input.canonicalHeadCommit,
			headCommit: currentHead(input.workspaceDir),
			reason: commit.reason,
			validation,
		});
	}
	return validateAndFastForwardCanonical(selector, {
		branch: input.branch,
		baseCommit: input.baseCommit,
		canonicalHeadCommit: input.canonicalHeadCommit,
		validationCommand: input.validationCommand,
		validation,
		resolutionAttempts: 0,
	});
}
