import type { AutomationWorktreeSelector } from "./worktree-lifecycle-types.js";
import {
	captureMergeIndexSnapshot,
	type MergeIndexSnapshot,
} from "./worktree-merge-gate-finalize.js";
import {
  canonicalConflictDiff,
  currentHead,
} from "./worktree-merge-gate-support.js";
import type {
  MergeGateConflict,
  MergeGateResolutionReview,
  MergeGateResolverRequest,
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
  destructivePaths: string[];
  validation: MergeGateValidation | null;
  previousReview?: MergeGateResolutionReview;
	attempt: number;
	maxResolutionAttempts: number;
	validationCommand?: readonly string[];
	beforeResolver: MergeIndexSnapshot;
};

export type MergeGatePhaseResult =
	| { kind: "complete"; result: MergeGateResult }
	| {
			kind: "resolve";
			state: MergeGateResolutionState;
			request: MergeGateResolverRequest;
	  };

export function completeMergeGatePhase(result: MergeGateResult): MergeGatePhaseResult {
	return { kind: "complete", result };
}

export function createMergeGateResolutionPhase(
	input: Omit<MergeGateResolutionState, "beforeResolver">,
): MergeGatePhaseResult {
	const beforeResolver = captureMergeIndexSnapshot(input.workspaceDir);
	return {
		kind: "resolve",
		state: {
			...input,
			beforeResolver,
		},
		request: {
			taskId: input.selector.taskId,
			workspaceDir: input.workspaceDir,
			branch: input.branch,
			baseCommit: input.baseCommit,
			canonicalHeadCommit: input.canonicalHeadCommit,
			headCommit: currentHead(input.workspaceDir),
			canonicalDiff: canonicalConflictDiff(
				input.workspaceDir,
				input.baseCommit,
				input.canonicalHeadCommit,
				input.conflicts,
			),
			attempt: input.attempt,
			conflicts: input.conflicts,
			previousValidation: input.validation,
			...(input.previousReview !== undefined
				? { previousReview: input.previousReview }
				: {}),
		},
	};
}
