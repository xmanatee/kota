import {
	boundedActualConflicts,
	canonicalDestructivePaths,
	hasUnresolvableBoundedConflict,
	resurrectedDestructivePaths,
} from "./worktree-canonical-reconciliation-support.js";
import { inspectAutomationWorktree } from "./worktree-lifecycle.js";
import { readDirtyState } from "./worktree-lifecycle-support.js";
import type { AutomationWorktreeSelector } from "./worktree-lifecycle-types.js";
import {
	captureMergeIndexSnapshot,
	commitResolvedMerge,
	stageConflictPaths,
	validateAndFastForwardCanonical,
	validateResolvedMergeBoundary,
} from "./worktree-merge-gate-finalize.js";
import {
	acquireMergeGateLock,
	releaseMergeGateLock,
	writeMergeGateMetrics,
} from "./worktree-merge-gate-lock.js";
import { finishCleanMerge, pendingBlocked } from "./worktree-merge-gate-results.js";
import {
	abortMerge,
	canonicalConflictDiff,
	classifyConflicts,
	conflictMarkerConflicts,
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

async function resolveBoundedConflicts(
	selector: AutomationWorktreeSelector,
	input: MergeAutomationWorktreeInput & {
		branch: string;
		baseCommit: string;
		canonicalHeadCommit: string;
		workspaceDir: string;
		conflicts: MergeGateConflict[];
		destructivePaths: string[];
	},
): Promise<MergeGateResult> {
	const maxAttempts = input.maxResolutionAttempts ?? DEFAULT_MAX_RESOLUTION_ATTEMPTS;
	if (!input.resolver || maxAttempts <= 0) {
		return pending(selector, {
			branch: input.branch,
			baseCommit: input.baseCommit,
			canonicalHeadCommit: input.canonicalHeadCommit,
			headCommit: currentHead(input.workspaceDir),
			reason: "bounded conflicts require a configured merge resolver",
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
			taskId: selector.taskId,
			workspaceDir: input.workspaceDir,
			branch: input.branch,
			baseCommit: input.baseCommit,
			canonicalHeadCommit: input.canonicalHeadCommit,
			headCommit: currentHead(input.workspaceDir),
			canonicalDiff: canonicalConflictDiff(
				input.workspaceDir,
				input.baseCommit,
				input.canonicalHeadCommit,
				conflicts,
			),
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
		const unresolvedMarkers = conflictMarkerConflicts(input.workspaceDir, conflicts);
		if (unresolvedMarkers.length > 0) {
			conflicts = unresolvedMarkers;
			validation = runValidation(input.workspaceDir, input.validationCommand);
			continue;
		}
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
		const resurrected = resurrectedDestructivePaths(
			input.workspaceDir,
			input.destructivePaths,
		);
		if (resurrected.length > 0) {
			return pendingBlocked(selector, {
				branch: input.branch,
				baseCommit: input.baseCommit,
				canonicalHeadCommit: input.canonicalHeadCommit,
				headCommit: currentHead(input.workspaceDir),
				reason: "resolved merge would resurrect paths deleted or renamed on canonical",
				conflicts: resurrected.map((path) => ({
					path,
					kind: "blocked-path",
					reason: "canonical deletion or rename must remain authoritative",
				})),
				resolutionAttempts: attempt,
				validation: null,
			});
		}
		validation = runValidation(input.workspaceDir, input.validationCommand);
		if (!validation || validation.passed) {
			stageConflictPaths(input.workspaceDir, conflicts);
			const remaining = classifyConflicts(input.workspaceDir);
			if (remaining.length > 0) {
				conflicts = remaining;
				continue;
			}
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
				validation,
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

async function mergeAutomationWorktreeUnlocked(input: MergeAutomationWorktreeInput): Promise<MergeGateResult> {
	const selector: AutomationWorktreeSelector = {
		projectDir: input.projectDir,
		taskId: input.taskId,
		runId: input.runId,
	};
	const inspection = inspectAutomationWorktree(selector);
	const { metadata } = inspection;
	const branch = inspection.branch;
	const baseCommit = metadata.baseCommit;
	const workspaceDir = metadata.workspaceDir;
	const canonicalHeadCommit = currentHead(selector.projectDir);

	if (!inspection.exists) {
		return pendingBlocked(selector, {
			branch,
			baseCommit,
			canonicalHeadCommit,
			headCommit: inspection.headCommit,
			reason: "worktree path is missing",
		});
	}
	const workspaceHeadCommit = currentHead(workspaceDir);
	const canonicalDirty = readDirtyState(selector.projectDir);
	if (canonicalDirty.trackedDirty || canonicalDirty.untracked) {
		return pendingBlocked(selector, {
			branch,
			baseCommit,
			canonicalHeadCommit,
			headCommit: workspaceHeadCommit,
			reason: `canonical checkout is dirty before merge gate: ${canonicalDirty.entries.join(", ")}`,
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
			const destructivePaths = canonicalDestructivePaths(
				workspaceDir,
				baseCommit,
				canonicalHeadCommit,
			);
			const conflicts = boundedActualConflicts(
				classifyConflicts(workspaceDir),
				new Set(destructivePaths),
			);
			if (
				hasUnresolvableBoundedConflict(
					conflicts,
					new Set(destructivePaths),
				)
			) {
				return pendingBlocked(selector, {
					branch,
					baseCommit,
					canonicalHeadCommit,
					headCommit: currentHead(workspaceDir),
					reason: "merge contains binary, generated, rename, or structural conflicts outside canonical destructive paths",
					conflicts,
				});
			}
			return await resolveBoundedConflicts(selector, {
				...input,
				branch,
				baseCommit,
				canonicalHeadCommit,
				workspaceDir,
				conflicts,
				destructivePaths,
			});
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

export async function mergeAutomationWorktree(input: MergeAutomationWorktreeInput): Promise<MergeGateResult> {
	const selector: AutomationWorktreeSelector = {
		projectDir: input.projectDir,
		taskId: input.taskId,
		runId: input.runId,
	};
	const lock = await acquireMergeGateLock({
		projectDir: input.projectDir,
		taskId: input.taskId,
		runId: input.runId,
		timeoutMs: input.lockTimeoutMs,
	});
	if (!lock.acquired) {
		const inspection = inspectAutomationWorktree(selector);
		const workspaceHeadCommit = inspection.exists ? currentHead(inspection.metadata.workspaceDir) : "";
		return writeMergeGateMetrics(
			pendingBlocked(selector, {
				branch: inspection.branch,
				baseCommit: inspection.metadata.baseCommit,
				canonicalHeadCommit: currentHead(input.projectDir),
				headCommit: workspaceHeadCommit,
				reason: lock.reason,
			}),
			{
				waitMs: lock.waitMs,
				mergeDurationMs: 0,
				serializedByLock: true,
			},
		);
	}

	const mergeStartedAt = Date.now();
	try {
		const result = await mergeAutomationWorktreeUnlocked(input);
		return writeMergeGateMetrics(result, {
			waitMs: lock.waitMs,
			mergeDurationMs: Date.now() - mergeStartedAt,
			serializedByLock: true,
		});
	} finally {
		releaseMergeGateLock(input.projectDir);
	}
}
