import { defineWorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";
import { inspectAutomationWorktree } from "./worktree-lifecycle.js";
import type { AutomationWorktreeSelector } from "./worktree-lifecycle-types.js";
import { writeMergeGateMetrics } from "./worktree-merge-gate-lock.js";
import { pendingBlocked } from "./worktree-merge-gate-results.js";
import { currentHead } from "./worktree-merge-gate-support.js";
import type { MergeGateResult } from "./worktree-merge-gate-types.js";

export function mergeGateLockFailureInWorker(input: {
	selector: AutomationWorktreeSelector;
	reason: string;
	waitMs: number;
}): MergeGateResult {
	const inspection = inspectAutomationWorktree(input.selector);
	const workspaceHeadCommit = inspection.exists
		? currentHead(inspection.metadata.workspaceDir)
		: "";
	return writeMergeGateMetrics(
		pendingBlocked(input.selector, {
			branch: inspection.branch,
			baseCommit: inspection.metadata.baseCommit,
			canonicalHeadCommit: currentHead(input.selector.projectDir),
			headCommit: workspaceHeadCommit,
			reason: input.reason,
		}),
		{
			waitMs: input.waitMs,
			mergeDurationMs: 0,
			serializedByLock: true,
		},
	);
}

export function writeMergeGateMetricsInWorker(input: {
	result: MergeGateResult;
	waitMs: number;
	mergeDurationMs: number;
}): MergeGateResult {
	return writeMergeGateMetrics(input.result, {
		waitMs: input.waitMs,
		mergeDurationMs: input.mergeDurationMs,
		serializedByLock: true,
	});
}

export const mergeGateLockFailureOperation = defineWorkflowBlockingOperation<
	{ selector: AutomationWorktreeSelector; reason: string; waitMs: number },
	MergeGateResult
>(import.meta.url, "mergeGateLockFailureInWorker");

export const writeMergeGateMetricsOperation = defineWorkflowBlockingOperation<
	{ result: MergeGateResult; waitMs: number; mergeDurationMs: number },
	MergeGateResult
>(import.meta.url, "writeMergeGateMetricsInWorker");
