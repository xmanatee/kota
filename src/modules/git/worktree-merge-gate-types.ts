import type { AutomationWorktreeSelector } from "./worktree-lifecycle-types.js";

export type MergeConflictKind = "text" | "binary" | "blocked-path";

export type MergeGateConflict = {
	path: string;
	kind: MergeConflictKind;
	reason: string;
};

export type MergeGateValidation = {
	command: string[];
	exitCode: number | null;
	stdoutTail: string;
	stderrTail: string;
	passed: boolean;
};

export type MergeGateResolutionReview = {
	summary: string;
	taskScopeJustification: string;
	pathJudgments: Array<{
		path: string;
		decision: "preserve-branch" | "accept-canonical" | "combine";
		rationale: string;
	}>;
};

export type MergeGateMetrics = {
	waitMs: number;
	mergeDurationMs: number;
	conflictCount: number;
	resolverAttempts: number;
	validationFailures: number;
	serializedByLock: boolean;
};

export type MergeGateResolverRequest = {
	taskId: string;
	workspaceDir: string;
	branch: string;
	baseCommit: string;
	canonicalHeadCommit: string;
	headCommit: string;
	canonicalDiff: string;
	attempt: number;
	conflicts: MergeGateConflict[];
	previousValidation: MergeGateValidation | null;
	previousReview?: MergeGateResolutionReview;
};

export type MergeGateResolverResult = {
	resolved: boolean;
	summary: string;
	reviewFeedback?: MergeGateResolutionReview;
};

export type MergeGateResolver = (request: MergeGateResolverRequest) => Promise<MergeGateResolverResult> | MergeGateResolverResult;

export type MergeGateStatus = "merged" | "pending-conflict" | "blocked";

export type MergeGateResult = {
	status: MergeGateStatus;
	taskId: string;
	runId: string;
	branch: string;
	baseCommit: string;
	canonicalHeadCommit: string;
	headCommit: string;
	mergeCommit: string | null;
	reason: string | null;
	conflicts: MergeGateConflict[];
	resolutionAttempts: number;
	validation: MergeGateValidation | null;
	metrics: MergeGateMetrics;
	artifactPath: string;
};

export type MergeAutomationWorktreeInput = AutomationWorktreeSelector & {
	validationCommand?: readonly string[];
	resolver?: MergeGateResolver;
	maxResolutionAttempts?: number;
	signal?: AbortSignal;
};
