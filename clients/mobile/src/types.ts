// Daemon API response types

export interface HealthResponse {
  status: 'ok' | 'degraded';
  version: string;
  uptimeMs: number;
  components: Record<string, string>;
}

export interface ActiveRun {
  runId: string;
  workflow: string;
  startedAt: string;
}

export interface WorkflowState {
  activeRuns: ActiveRun[];
  queueLength: number;
  completedRuns: number;
  paused: boolean;
  dispatchWindowBlocked?: boolean;
  dispatchWindowOpensAt?: string;
}

export interface DaemonStatus {
  running: boolean;
  pid: number;
  startedAt: string;
  completedRuns: number;
  lastCompletedWorkflow?: string;
  lastCompletedAt?: string;
  lastCompletedStatus?: string;
  workflow: WorkflowState;
}

export type RunStatus = 'success' | 'failed' | 'interrupted' | 'completed-with-warnings';

export interface RunSummary {
  id: string;
  workflow: string;
  status: RunStatus;
  triggerEvent: string;
  startedAt: string;
  durationMs: number;
  totalCostUsd?: number;
  causedBy?: { runId: string; workflow: string };
  tags?: string[];
}

export interface ToolCall {
  tool: string;
  count: number;
  totalMs: number;
}

export interface RunStep {
  id: string;
  type: string;
  status: string;
  durationMs: number;
  costUsd?: number;
  toolCalls?: ToolCall[];
  reused?: boolean;
}

export interface RunDetail extends RunSummary {
  completedAt?: string;
  steps: RunStep[];
  workflowSteps?: Array<{ id: string; type: string; reason?: string }>;
  warnings?: Array<{ type: string; message: string }>;
}

export interface Approval {
  id: string;
  tool: string;
  input: Record<string, unknown>;
  risk: string;
  reason?: string;
  createdAt: string;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  timeoutMs?: number;
}

export type OwnerQuestionStatus = 'pending' | 'answered' | 'dismissed' | 'expired';

export interface OwnerQuestion {
  id: string;
  context: string;
  question: string;
  reason: string;
  source: string;
  createdAt: string;
  status: OwnerQuestionStatus;
  proposedAnswers?: string[];
  answer?: string;
  answeredAt?: string;
}

export interface TaskCounts {
  inbox?: number;
  ready?: number;
  backlog?: number;
  doing?: number;
  blocked?: number;
}

export interface TaskEntry {
  id: string;
  title: string;
  priority: string;
  area: string;
  summary: string;
}

export interface TasksResponse {
  counts: TaskCounts;
  tasks: {
    doing?: TaskEntry[];
    ready?: TaskEntry[];
    backlog?: TaskEntry[];
    blocked?: TaskEntry[];
  };
}

export type SseEventType =
  | 'workflow.started'
  | 'workflow.completed'
  | 'workflow.step.completed'
  | 'queue.changed'
  | 'approval.changed'
  | 'task.changed'
  | 'owner.question.asked'
  | 'owner.question.changed'
  | 'owner.question.resolved'
  | 'owner.question.dismissed'
  | 'owner.question.expired';

export interface SseEvent {
  type: SseEventType;
  payload: Record<string, unknown>;
  timestamp?: string;
}

export type AutonomyMode = 'passive' | 'supervised' | 'autonomous';

export interface InteractiveSession {
  id: string;
  createdAt: string;
  lastActive: number;
  autonomyMode: AutonomyMode;
  source?: 'daemon' | 'serve';
  busy?: boolean;
}

export interface SetAutonomyModeResponse {
  session_id: string;
  autonomy_mode: AutonomyMode;
  source?: string;
  serveOwned?: boolean;
}

export type ChatStreamEventType = 'session' | 'text' | 'thinking' | 'thinking_start' | 'progress' | 'status' | 'cost' | 'error' | 'notification' | 'guardrail' | 'tool_metric' | 'state_change' | 'done';

export interface ChatStreamEvent {
  type: ChatStreamEventType;
  payload: Record<string, unknown>;
}
