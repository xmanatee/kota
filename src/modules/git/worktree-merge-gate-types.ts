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

export type MergeGateResolverRequest = {
	workspaceDir: string;
	attempt: number;
	conflicts: MergeGateConflict[];
	previousValidation: MergeGateValidation | null;
};

export type MergeGateResolverResult = {
	resolved: boolean;
	summary: string;
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
	artifactPath: string;
};

export type MergeAutomationWorktreeInput = AutomationWorktreeSelector & {
	validationCommand?: readonly string[];
	resolver?: MergeGateResolver;
	maxResolutionAttempts?: number;
};
