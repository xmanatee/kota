import type { AutomationWorktreeSelector } from "./worktree-lifecycle-types.js";
import {
	captureMergeIndexSnapshot,
	type MergeIndexSnapshot,
} from "./worktree-merge-gate-finalize.js";
import type {
	MergeGateConflict,
	MergeGateResult,
	MergeGateValidation,
} from "./worktree-merge-gate-types.js";

export type MergeGatePhaseInput = AutomationWorktreeSelector & {
	validationCommand?: readonly string[];
	resolverConfigured: boolean;
	maxResolutionAttempts: number;
};

export type MergeGateResolutionState = {
	selector: AutomationWorktreeSelector;
	branch: string;
	baseCommit: string;
	canonicalHeadCommit: string;
	workspaceDir: string;
	conflicts: MergeGateConflict[];
	validation: MergeGateValidation | null;
	attempt: number;
	maxResolutionAttempts: number;
	validationCommand?: readonly string[];
	beforeResolver: MergeIndexSnapshot;
};

export type MergeGatePhaseResult =
	| { kind: "complete"; result: MergeGateResult }
	| { kind: "resolve"; state: MergeGateResolutionState };

export function completeMergeGatePhase(result: MergeGateResult): MergeGatePhaseResult {
	return { kind: "complete", result };
}

export function createMergeGateResolutionPhase(
	input: Omit<MergeGateResolutionState, "beforeResolver">,
): MergeGatePhaseResult {
	return {
		kind: "resolve",
		state: {
			...input,
			beforeResolver: captureMergeIndexSnapshot(input.workspaceDir),
		},
	};
}
