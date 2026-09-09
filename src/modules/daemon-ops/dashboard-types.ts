import type { WorkflowDispatchPauseStatus } from "#core/workflow/dispatch-pause-types.js";
import type {
	WorkflowQueuedRun,
	WorkflowRunStatus,
} from "#core/workflow/run-types.js";
import type { WorkflowAgentBackoffState, WorkflowAgentOperatingState } from "#core/workflow/trigger-types.js";
import type { RepoWorkSupply } from "#modules/repo-tasks/work-supply.js";

export type DashboardTaskQueue = Pick<RepoWorkSupply,
	"counts" | "inboxCount" | "activeCount" | "dispatchableCount" | "hasDispatchableWork" |
	"ownershipAvailable" | "availableCount" | "runningCount" | "queuedCount" | "retainedCount"
>;

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
	agentOperatingState?: WorkflowAgentOperatingState;
	definitionCount: number;
	sessionCount: number;
	taskQueue?: DashboardTaskQueue;
};
