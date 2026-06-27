import { inspectAutomationWorktree } from "./worktree-lifecycle.js";
import { assertCanonicalCheckoutReady } from "./worktree-lifecycle-support.js";
import type { AutomationWorktreeSelector } from "./worktree-lifecycle-types.js";
import {
	captureMergeIndexSnapshot,
	commitResolvedMerge,
	stageConflictPaths,
	validateAndFastForwardCanonical,
	validateResolvedMergeBoundary,
} from "./worktree-merge-gate-finalize.js";
import {
	abortMerge,
	classifyConflicts,
	currentHead,
	DEFAULT_MAX_RESOLUTION_ATTEMPTS,
	isAncestor,
	pending,
	runGit,
	runValidation,
} from "./worktree-merge-gate-support.js";
import type {
	MergeAutomationWorktreeInput,
	MergeGateConflict,
	MergeGateResult,
	MergeGateValidation,
} from "./worktree-merge-gate-types.js";

export type {
	MergeAutomationWorktreeInput,
	MergeConflictKind,
	MergeGateConflict,
	MergeGateResolver,
	MergeGateResolverRequest,
	MergeGateResolverResult,
	MergeGateResult,
	MergeGateStatus,
	MergeGateValidation,
} from "./worktree-merge-gate-types.js";

function pendingBlocked(
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

function finishCleanMerge(
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
		resolutionAttempts: 0,
	});
}

async function resolveTextConflicts(
	selector: AutomationWorktreeSelector,
	input: MergeAutomationWorktreeInput & {
		branch: string;
		baseCommit: string;
		canonicalHeadCommit: string;
		workspaceDir: string;
		conflicts: MergeGateConflict[];
	},
): Promise<MergeGateResult> {
	const maxAttempts = input.maxResolutionAttempts ?? DEFAULT_MAX_RESOLUTION_ATTEMPTS;
	if (!input.resolver || maxAttempts <= 0) {
		return pending(selector, {
			branch: input.branch,
			baseCommit: input.baseCommit,
			canonicalHeadCommit: input.canonicalHeadCommit,
			headCommit: currentHead(input.workspaceDir),
			reason: "text conflicts require a configured merge resolver",
			conflicts: input.conflicts,
			resolutionAttempts: 0,
			validation: null,
		});
	}
	let validation: MergeGateValidation | null = null;
	let conflicts = input.conflicts;
	for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
		const beforeResolver = captureMergeIndexSnapshot(input.workspaceDir);
		const resolution = await input.resolver({
			workspaceDir: input.workspaceDir,
			attempt,
			conflicts,
			previousValidation: validation,
		});
		if (!resolution.resolved) {
			return pending(selector, {
				branch: input.branch,
				baseCommit: input.baseCommit,
				canonicalHeadCommit: input.canonicalHeadCommit,
				headCommit: currentHead(input.workspaceDir),
				reason: resolution.summary || "merge resolver did not resolve conflicts",
				conflicts,
				resolutionAttempts: attempt,
				validation,
			});
		}
		const unresolvedMarkers = stageConflictPaths(input.workspaceDir, conflicts);
		if (unresolvedMarkers.length > 0) {
			conflicts = unresolvedMarkers;
			validation = runValidation(input.workspaceDir, input.validationCommand);
			continue;
		}
		const remaining = classifyConflicts(input.workspaceDir);
		if (remaining.length > 0) conflicts = remaining;
		if (remaining.length === 0) {
			const boundaryViolation = validateResolvedMergeBoundary(input.workspaceDir, {
				beforeResolver,
				allowedConflictPaths: conflicts.map((conflict) => conflict.path),
			});
			if (boundaryViolation) {
				return pendingBlocked(selector, {
					branch: input.branch,
					baseCommit: input.baseCommit,
					canonicalHeadCommit: input.canonicalHeadCommit,
					headCommit: currentHead(input.workspaceDir),
					reason: boundaryViolation.reason,
					conflicts: boundaryViolation.conflicts,
					resolutionAttempts: attempt,
					validation: null,
				});
			}
		}
		validation = runValidation(input.workspaceDir, input.validationCommand);
		if (remaining.length === 0 && (!validation || validation.passed)) {
			const commit = commitResolvedMerge(input.workspaceDir, input.branch);
			if (!commit.ok) {
				return pendingBlocked(selector, {
					branch: input.branch,
					baseCommit: input.baseCommit,
					canonicalHeadCommit: input.canonicalHeadCommit,
					headCommit: currentHead(input.workspaceDir),
					reason: commit.reason,
					conflicts: [],
					resolutionAttempts: attempt,
					validation,
				});
			}
			return validateAndFastForwardCanonical(selector, {
				branch: input.branch,
				baseCommit: input.baseCommit,
				canonicalHeadCommit: input.canonicalHeadCommit,
				validationCommand: input.validationCommand,
				resolutionAttempts: attempt,
			});
		}
	}
	return pendingBlocked(selector, {
		branch: input.branch,
		baseCommit: input.baseCommit,
		canonicalHeadCommit: input.canonicalHeadCommit,
		headCommit: currentHead(input.workspaceDir),
		reason: "merge resolver exhausted bounded attempts",
		conflicts,
		resolutionAttempts: maxAttempts,
		validation,
	});
}

export async function mergeAutomationWorktree(input: MergeAutomationWorktreeInput): Promise<MergeGateResult> {
	const selector: AutomationWorktreeSelector = {
		projectDir: input.projectDir,
		taskId: input.taskId,
		runId: input.runId,
	};
	assertCanonicalCheckoutReady(selector.projectDir);
	const inspection = inspectAutomationWorktree(selector);
	const { metadata } = inspection;
	const branch = inspection.branch;
	const baseCommit = metadata.baseCommit;
	const workspaceDir = metadata.workspaceDir;
	const canonicalHeadCommit = currentHead(selector.projectDir);
	const workspaceHeadCommit = currentHead(workspaceDir);

	if (!inspection.exists) {
		return pendingBlocked(selector, {
			branch,
			baseCommit,
			canonicalHeadCommit,
			headCommit: workspaceHeadCommit,
			reason: "worktree path is missing",
		});
	}
	if (inspection.dirty.dirty) {
		return pendingBlocked(selector, {
			branch,
			baseCommit,
			canonicalHeadCommit,
			headCommit: workspaceHeadCommit,
			reason: `worktree is dirty before merge gate: ${inspection.dirty.entries.join(", ")}`,
		});
	}
	if (isAncestor(workspaceDir, workspaceHeadCommit, canonicalHeadCommit)) {
		return validateAndFastForwardCanonical(selector, {
			branch,
			baseCommit,
			canonicalHeadCommit,
			validationCommand: input.validationCommand,
			resolutionAttempts: 0,
		});
	}
	if (!isAncestor(workspaceDir, canonicalHeadCommit, workspaceHeadCommit)) {
		const merge = runGit(workspaceDir, ["merge", "--no-ff", "--no-commit", canonicalHeadCommit]);
		if (!merge.ok) {
			const conflicts = classifyConflicts(workspaceDir);
			if (conflicts.some((conflict) => conflict.kind !== "text")) {
				return pendingBlocked(selector, {
					branch,
					baseCommit,
					canonicalHeadCommit,
					headCommit: currentHead(workspaceDir),
					reason: "merge contains binary, generated, or high-risk conflicts",
					conflicts,
				});
			}
			return await resolveTextConflicts(selector, { ...input, branch, baseCommit, canonicalHeadCommit, workspaceDir, conflicts });
		}
		return finishCleanMerge(selector, {
			branch,
			baseCommit,
			canonicalHeadCommit,
			workspaceDir,
			validationCommand: input.validationCommand,
		});
	}
	abortMerge(workspaceDir);
	return validateAndFastForwardCanonical(selector, {
		branch,
		baseCommit,
		canonicalHeadCommit,
		validationCommand: input.validationCommand,
		resolutionAttempts: 0,
	});
}
