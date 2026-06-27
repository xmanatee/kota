export type AutomationWorktreeState = "active" | "pending-merge" | "merged" | "removed";

export type AutomationWorktreeMetadata = {
	schemaVersion: 1;
	taskId: string;
	runId: string;
	workflowId: string;
	owner: string;
	workspaceDir: string;
	branch: string;
	baseCommit: string;
	createdAt: string;
	updatedAt: string;
	state: AutomationWorktreeState;
	copiedSetupFiles: string[];
	lastCleanupBlockers?: string[];
	stateReason?: string;
	removedAt?: string;
	mergedAt?: string;
	mergedCommit?: string;
};

export type WorktreeDirtyState = {
	dirty: boolean;
	trackedDirty: boolean;
	untracked: boolean;
	conflicted: boolean;
	entries: string[];
};

export type WorktreeLockState = {
	locked: boolean;
	reason: string | null;
};

export type WorktreePushState = {
	hasLocalCommits: boolean;
	remoteUpstream: string | null;
	aheadCount: number | null;
	unpushed: boolean;
};

export type CleanupEligibility = {
	eligible: boolean;
	blockers: string[];
};

export type AutomationWorktreeInspection = {
	metadata: AutomationWorktreeMetadata;
	metadataPath: string;
	exists: boolean;
	branch: string;
	baseCommit: string;
	headCommit: string;
	dirty: WorktreeDirtyState;
	lock: WorktreeLockState;
	push: WorktreePushState;
	cleanup: CleanupEligibility;
};

export type CreateAutomationWorktreeInput = {
	projectDir: string;
	taskId: string;
	runId: string;
	workflowId: string;
	owner: string;
	baseRef?: string;
	includeFile?: string;
	worktreeRoot?: string;
};

export type AutomationWorktreeSelector = {
	projectDir: string;
	taskId: string;
	runId: string;
};

export type WorktreeListEntry = {
	path: string;
	headCommit: string;
	branch: string;
	lock: WorktreeLockState;
};
