export type AutomationWorktreeState = "active" | "pending-merge" | "merged" | "removed";

export type AutomationWorktreeOperatorState =
	| "active"
	| "pending-merge"
	| "conflicted"
	| "merged"
	| "removed";

export type AutomationWorktreeCleanupStatus = "eligible" | "blocked" | "removed";

export type AutomationWorktreeDirtySummary = "clean" | "dirty" | "conflicted";

export type AutomationWorktreeOperatorStatus = {
	taskId: string;
	runId: string;
	workflowId: string;
	owner: string;
	workspaceDir: string;
	metadataPath: string;
	exists: boolean;
	branch: string;
	baseCommit: string;
	headCommit: string;
	state: AutomationWorktreeOperatorState;
	metadataState: AutomationWorktreeState;
	dirtyState: AutomationWorktreeDirtySummary;
	dirtyEntries: string[];
	mergeStatus: string;
	cleanupStatus: AutomationWorktreeCleanupStatus;
	cleanupEligible: boolean;
	cleanupBlockers: string[];
	runtimeResources?: AutomationWorktreeRuntimeResources;
	nextAction: string;
};

export type AutomationWorktreeRuntimeResources = {
	profileId: string;
	agentRunDir: string;
	tempRoot?: string;
	artifactRoot?: string;
	ports?: {
		start: number;
		end: number;
	};
};

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
	runtimeResources?: AutomationWorktreeRuntimeResources;
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
