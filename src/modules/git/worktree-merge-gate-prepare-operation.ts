import { defineWorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";
import {
  boundedActualConflicts,
  canonicalDestructivePaths,
  hasUnresolvableBoundedConflict,
} from "./worktree-canonical-reconciliation-support.js";
import { inspectAutomationWorktree } from "./worktree-lifecycle.js";
import { readDirtyState } from "./worktree-lifecycle-support.js";
import type { AutomationWorktreeSelector } from "./worktree-lifecycle-types.js";
import { validateAndFastForwardCanonical } from "./worktree-merge-gate-finalize.js";
import {
	completeMergeGatePhase,
	createMergeGateResolutionPhase,
	type MergeGatePhaseInput,
	type MergeGatePhaseResult,
} from "./worktree-merge-gate-operation-types.js";
import { finishCleanMerge, pendingBlocked } from "./worktree-merge-gate-results.js";
import {
	abortMerge,
	classifyConflicts,
	currentHead,
	isAncestor,
	pending,
	runGit,
} from "./worktree-merge-gate-support.js";
import type { MergeGateConflict } from "./worktree-merge-gate-types.js";

function pendingWithoutResolver(
	selector: AutomationWorktreeSelector,
	input: {
		branch: string;
		baseCommit: string;
		canonicalHeadCommit: string;
		workspaceDir: string;
		conflicts: MergeGateConflict[];
	},
): MergeGatePhaseResult {
	return completeMergeGatePhase(
		pending(selector, {
			branch: input.branch,
			baseCommit: input.baseCommit,
			canonicalHeadCommit: input.canonicalHeadCommit,
			headCommit: currentHead(input.workspaceDir),
      reason: "bounded conflicts require a configured merge resolver",
			conflicts: input.conflicts,
			resolutionAttempts: 0,
			validation: null,
		}),
	);
}

export function prepareMergeAutomationWorktreeInWorker(
	input: MergeGatePhaseInput,
): MergeGatePhaseResult {
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
		return completeMergeGatePhase(
			pendingBlocked(selector, {
				branch,
				baseCommit,
				canonicalHeadCommit,
        headCommit: inspection.headCommit,
				reason: "worktree path is missing",
			}),
		);
  }
  const workspaceHeadCommit = currentHead(workspaceDir);
  const canonicalDirty = readDirtyState(selector.projectDir);
	if (canonicalDirty.trackedDirty || canonicalDirty.untracked) {
		return completeMergeGatePhase(
			pendingBlocked(selector, {
				branch,
				baseCommit,
				canonicalHeadCommit,
				headCommit: workspaceHeadCommit,
				reason: `canonical checkout is dirty before merge gate: ${canonicalDirty.entries.join(", ")}`,
			}),
		);
	}
	if (inspection.dirty.dirty) {
		return completeMergeGatePhase(
			pendingBlocked(selector, {
				branch,
				baseCommit,
				canonicalHeadCommit,
				headCommit: workspaceHeadCommit,
				reason: `worktree is dirty before merge gate: ${inspection.dirty.entries.join(", ")}`,
			}),
		);
	}
	if (isAncestor(workspaceDir, workspaceHeadCommit, canonicalHeadCommit)) {
		return completeMergeGatePhase(
			validateAndFastForwardCanonical(selector, {
				branch,
				baseCommit,
				canonicalHeadCommit,
				validationCommand: input.validationCommand,
				resolutionAttempts: 0,
			}),
		);
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
      if (hasUnresolvableBoundedConflict(conflicts, new Set(destructivePaths))) {
        return completeMergeGatePhase(
					pendingBlocked(selector, {
						branch,
						baseCommit,
						canonicalHeadCommit,
						headCommit: currentHead(workspaceDir),
            reason: "merge contains binary, generated, rename, or structural conflicts outside canonical destructive paths",
						conflicts,
					}),
				);
			}
			if (!input.resolverConfigured || input.maxResolutionAttempts <= 0) {
				return pendingWithoutResolver(selector, {
					branch,
					baseCommit,
					canonicalHeadCommit,
					workspaceDir,
					conflicts,
				});
			}
			return createMergeGateResolutionPhase({
				selector,
				branch,
				baseCommit,
				canonicalHeadCommit,
				workspaceDir,
        conflicts,
        destructivePaths,
        validation: null,
				attempt: 1,
				maxResolutionAttempts: input.maxResolutionAttempts,
				validationCommand: input.validationCommand,
			});
		}
		return completeMergeGatePhase(
			finishCleanMerge(selector, {
				branch,
				baseCommit,
				canonicalHeadCommit,
				workspaceDir,
				validationCommand: input.validationCommand,
			}),
		);
	}
	abortMerge(workspaceDir);
	return completeMergeGatePhase(
		validateAndFastForwardCanonical(selector, {
			branch,
			baseCommit,
			canonicalHeadCommit,
			validationCommand: input.validationCommand,
			resolutionAttempts: 0,
		}),
	);
}

export const prepareMergeAutomationWorktreeOperation = defineWorkflowBlockingOperation<
	MergeGatePhaseInput,
	MergeGatePhaseResult
>(import.meta.url, "prepareMergeAutomationWorktreeInWorker");
