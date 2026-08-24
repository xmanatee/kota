import { defineWorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";
import { writeMergeGateMetrics } from "./worktree-merge-gate-lock.js";
import type { MergeGateResult } from "./worktree-merge-gate-types.js";

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

export const writeMergeGateMetricsOperation = defineWorkflowBlockingOperation<
	{ result: MergeGateResult; waitMs: number; mergeDurationMs: number },
	MergeGateResult
>(import.meta.url, "writeMergeGateMetricsInWorker");
