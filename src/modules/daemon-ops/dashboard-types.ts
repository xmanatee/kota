import type { WorkflowDispatchPauseStatus } from "#core/workflow/dispatch-pause-types.js";
import type {
	WorkflowQueuedRun,
	WorkflowRunStatus,
} from "#core/workflow/run-types.js";
import type { WorkflowAgentBackoffState } from "#core/workflow/trigger-types.js";

export type DashboardTaskQueue = {
	counts: {
		open: number;
		blocked: number;
		done: number;
		dropped: number;
	};
	inboxCount: number;
	activeCount: number;
	actionableCount: number;
	dispatchableCount: number;
	hasDispatchableWork: boolean;
};

export type DashboardSnapshot = {
	pid: number;
	startedAt: string;
	running: boolean;
	stopping: boolean;
	completedRuns: number;
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
	definitionCount: number;
	sessionCount: number;
	taskQueue?: DashboardTaskQueue;
};
