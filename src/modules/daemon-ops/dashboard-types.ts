import type {
	WorkflowDispatchPauseStatus,
	WorkflowRecoveryStatus,
} from "#core/workflow/recovery-status-types.js";
import type {
	WorkflowQueuedRun,
	WorkflowRecoveryState,
	WorkflowRunStatus,
} from "#core/workflow/run-types.js";
import type { WorkflowAgentBackoffState } from "#core/workflow/trigger-types.js";

export type DashboardTaskQueue = {
	counts: {
		backlog: number;
		ready: number;
		doing: number;
		blocked: number;
		done: number;
		dropped: number;
	};
	inboxCount: number;
	openCount: number;
	pullableCount: number;
	actionableCount: number;
	promotableBacklogCount: number;
	dispatchableCount: number;
	hasDispatchableWork: boolean;
};

export type DashboardRecovery =
	| WorkflowRecoveryState
	| Exclude<WorkflowRecoveryStatus, { status: "none" }>;

export type DashboardSnapshot = {
	pid: number;
	startedAt: string;
	running: boolean;
	stopping: boolean;
	completedRuns: number;
	totalCostUsd?: number;
	lastCompletedWorkflow?: string;
	lastCompletedAt?: string;
	lastCompletedStatus?: WorkflowRunStatus;
	activeRuns: Array<{ runId: string; workflow: string; startedAt: string }>;
	pendingRuns: WorkflowQueuedRun[];
	dispatchPaused: boolean;
	dispatchPause?: WorkflowDispatchPauseStatus;
	dispatchWindowBlocked?: boolean;
	dispatchWindowOpensAt?: string;
	agentBackoff?: WorkflowAgentBackoffState;
	recovery?: DashboardRecovery;
	definitionCount: number;
	sessionCount: number;
	taskQueue?: DashboardTaskQueue;
};
