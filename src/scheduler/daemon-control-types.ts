import type { PendingApproval } from "../extensions/approval-queue/queue.js";
import type { ConversationData, ConversationRecord } from "../memory/history-utils.js";
import type { ToolCallSummaryEntry, WorkflowActiveRun, WorkflowQueuedRun, WorkflowRuntimeState } from "../workflow/run-types.js";
import type { WorkflowAgentBackoffState } from "../workflow/types.js";
import type { DaemonState } from "./daemon-state.js";

export type WorkflowDefinitionTriggerSummary =
  | { type: "event"; event: string }
  | { type: "cron"; schedule: string }
  | { type: "interval"; intervalMs: number }
  | { type: "webhook" }
  | { type: "watch"; patterns: string[]; debounceMs: number };

export type WorkflowDefinitionSummary = {
  name: string;
  enabled: boolean;
  /** Present only when a runtime override differs from the static source `enabled` value. */
  runtimeEnabled?: boolean;
  stepCount: number;
  triggers: WorkflowDefinitionTriggerSummary[];
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
};

export type DaemonControlAddress = {
  port: number;
  pid: number;
  startedAt: string;
  token: string;
};

/**
 * Capability scopes for daemon control access.
 * - read: observe daemon and workflow state, subscribe to events
 * - control: mutate workflow dispatch (pause/resume/abort/reload/trigger)
 */
export type CapabilityScope = "read" | "control";

export type WorkflowLiveStatus = {
  activeRuns: WorkflowActiveRun[];
  pendingRuns: WorkflowQueuedRun[];
  queueLength: number;
  completedRuns: number;
  totalCostUsd?: number;
  agentBackoff?: WorkflowAgentBackoffState;
  definitionsLoadedAt?: string;
  workflows: WorkflowRuntimeState["workflows"];
  paused: boolean;
  /** True when a dispatchWindow is configured and the current time is outside it. */
  dispatchWindowBlocked?: boolean;
  /** ISO timestamp of the next time the dispatch window opens (when blocked). */
  dispatchWindowOpensAt?: string;
  /** Active agent workflow concurrency limit (from scheduler.agentConcurrency or default 1). */
  agentConcurrency: number;
  /** Active code workflow concurrency limit (from scheduler.codeConcurrency or default 4). */
  codeConcurrency: number;
};

export type DaemonLiveStatus = DaemonState & {
  running: boolean;
  workflow: WorkflowLiveStatus;
  sessions: InteractiveSession[];
};

export type DaemonSseEventType =
  | "workflow.started"
  | "workflow.completed"
  | "workflow.step.completed"
  | "queue.changed"
  | "approval.changed"
  | "task.changed"
  | "session.registered"
  | "session.unregistered";

export type DaemonSseEvent = {
  type: DaemonSseEventType;
  payload: Record<string, unknown>;
};

export type WorkflowRunSummary = {
  id: string;
  workflow: string;
  status: string;
  triggerEvent: string;
  startedAt: string;
  durationMs?: number;
  totalCostUsd?: number;
  triggeredByRunId?: string;
  causedBy?: { runId: string; workflow: string };
  retryOf?: string;
  resumedFromRunId?: string;
  tags?: string[];
};

export type WorkflowRunStepSummary = {
  id: string;
  type: string;
  status: string;
  durationMs: number;
  error?: string;
  costUsd?: number;
  toolCalls?: ToolCallSummaryEntry[];
};

export type WorkflowRunDetail = WorkflowRunSummary & {
  completedAt?: string;
  triggerPayload?: Record<string, unknown>;
  steps: WorkflowRunStepSummary[];
  warnings?: Array<{ type: string; message: string }>;
};

export type DaemonTaskDetail = {
  id: string;
  title: string;
  priority: string;
  area: string;
  summary: string;
  body: string;
};

export type DaemonTaskStatusResponse = {
  counts: { inbox: number; ready: number; backlog: number; doing: number; blocked: number };
  tasks: {
    doing: DaemonTaskDetail[];
    ready: DaemonTaskDetail[];
    backlog: DaemonTaskDetail[];
    blocked: DaemonTaskDetail[];
  };
};

export type InteractiveSession = {
  id: string;
  createdAt: string;
  lastActive: number;
};

export type WorkflowRunCountEntry = {
  workflow: string;
  status: string;
  count: number;
};

export type WorkflowCostEntry = {
  workflow: string;
  costUsd: number;
};

export type WorkflowDurationHistogramEntry = {
  workflow: string;
  status: string;
  /** Bucket counts indexed by upper bound in seconds; "+Inf" always present */
  buckets: Array<{ le: number | "+Inf"; count: number }>;
  sum: number;
  count: number;
};

export type WorkflowMetricCounts = {
  runCounts: WorkflowRunCountEntry[];
  costTotals: WorkflowCostEntry[];
  durationHistogram: WorkflowDurationHistogramEntry[];
};

export type ComponentStatus = "ok" | "error";

export type HealthStatus = {
  scheduler: ComponentStatus;
  extensions: ComponentStatus;
};

export type DaemonControlHandle = {
  getDaemonLiveState(): DaemonState & { running: boolean };
  getHealthStatus(): HealthStatus;
  getWorkflowLiveStatus(): WorkflowLiveStatus;
  pauseWorkflowDispatch(): { already: boolean };
  resumeWorkflowDispatch(): { already: boolean };
  abortActiveRuns(): { aborted: number };
  abortActiveRun(runId: string): { ok: boolean; notFound?: boolean; queued?: boolean };
  reloadWorkflowDefinitions(): { count: number };
  reloadConfig(): Promise<{ workflows: number }>;
  getWorkflowDefinitions(): WorkflowDefinitionSummary[];
  enableWorkflow(name: string): { ok: boolean; notFound?: boolean };
  disableWorkflow(name: string): { ok: boolean; notFound?: boolean };
  enqueuePendingRun(name: string, tags?: string[], extraPayload?: Record<string, unknown>): { ok: boolean; queued?: string; runId?: string; alreadyQueued?: boolean; error?: string };
  cancelQueuedRun(runId: string): { ok: boolean; notFound?: boolean; active?: boolean };
  subscribeToEvents(handler: (event: DaemonSseEvent) => void): () => void;
  // History
  listHistory(search?: string, limit?: number): ConversationRecord[];
  getHistory(id: string): ConversationData | null;
  deleteHistory(id: string): boolean;
  // Approvals
  listApprovals(): PendingApproval[];
  approveApproval(id: string, note?: string): PendingApproval | null;
  rejectApproval(id: string, reason?: string): PendingApproval | null;
  // Tasks
  getTaskStatus(): DaemonTaskStatusResponse;
  // Workflow runs
  listWorkflowRuns(workflow?: string, limit?: number, tag?: string, causedByRunId?: string): WorkflowRunSummary[];
  getWorkflowRun(id: string): WorkflowRunDetail | null;
  // Metrics
  getWorkflowMetricCounts(): WorkflowMetricCounts;
  // Interactive sessions
  registerSession(id: string, createdAt: string): void;
  unregisterSession(id: string): void;
  listSessions(): InteractiveSession[];
  // Push notifications
  registerPushToken(deviceId: string, token: string): void;
  // Webhook triggers
  triggerWebhookRun(
    name: string,
    signature: string,
    rawBody: Buffer,
    payload: { body: unknown; headers: Record<string, string>; timestamp: string },
    webhookTimestamp?: string,
  ): { ok: boolean; runId?: string; unauthorized?: boolean; notFound?: boolean; alreadyRunning?: boolean; rateLimited?: boolean; retryAfterMs?: number; error?: string };
};
