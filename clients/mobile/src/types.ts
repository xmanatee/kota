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

/**
 * Voice success/failure shapes. Failure carries the daemon's typed `code`
 * (`stt-unavailable`, `tts-unavailable`, `tts-format-unsupported`, …) so
 * the mobile UI can render the same vocabulary the CLI and web client use.
 */
export type VoiceTranscribeResult =
  | { ok: true; text: string; language?: string }
  | { ok: false; status: number; error: string; code: string };

export type VoiceSynthesizeResult =
  | { ok: true; audio: Uint8Array; mimeType: string; format: string }
  | {
      ok: false;
      status: number;
      error: string;
      code: string;
      supported?: string[];
    };

/**
 * Mirror of the daemon's `DailyDigestData` shape exported from
 * `src/modules/autonomy/workflows/daily-digest/aggregate.ts`. Mobile decodes
 * `GET /api/digest` through these typed structures so the rendered body stays
 * identical to the Telegram, CLI, daemon HTTP, web, and macOS surfaces.
 */
export interface DigestBuilderCommitItem {
  runId: string;
  taskId: string | null;
  taskTitle: string | null;
  commitSubject: string;
  durationMs: number | null;
}

export interface DigestExplorerAdditionItem {
  runId: string;
  taskCount: number;
  watchlistAdds: number;
}

export interface DigestDecomposerSplitItem {
  runId: string;
  parentTaskId: string | null;
  childTaskCount: number;
}

export interface DigestBlockedPromoterMoveItem {
  runId: string;
  promotedTaskIds: string[];
  toReady: string[];
  toBacklog: string[];
}

export interface DigestFailedRunItem {
  runId: string;
  workflow: string;
  status: 'failed' | 'interrupted';
  startedAt: string;
}

export interface DigestPendingOwnerQuestionItem {
  id: string;
  question: string;
  source: string;
  ageDays: number;
}

export interface DigestAgingOperatorCaptureItem {
  taskId: string;
  ageDays: number;
  path: string;
}

export interface DigestQueueCounts {
  backlog: number;
  ready: number;
  doing: number;
  blocked: number;
}

export interface DigestQueueDelta {
  current: DigestQueueCounts;
  previous: DigestQueueCounts | null;
  delta: { [K in keyof DigestQueueCounts]: number | null };
}

export interface DailyDigestData {
  windowStartedAt: string;
  windowEndedAt: string;
  builderCommits: DigestBuilderCommitItem[];
  explorerAdditions: DigestExplorerAdditionItem[];
  decomposerSplits: DigestDecomposerSplitItem[];
  blockedPromoterMoves: DigestBlockedPromoterMoveItem[];
  failedMonitoredRuns: DigestFailedRunItem[];
  pendingOwnerQuestions: DigestPendingOwnerQuestionItem[];
  agingOperatorCaptures: DigestAgingOperatorCaptureItem[];
  queueDelta: DigestQueueDelta;
  quiet: boolean;
}

export interface DigestResponse {
  data: DailyDigestData;
  text: string;
}

/**
 * Mirror of the daemon's on-demand attention envelope exported from
 * `src/modules/autonomy/workflows/attention-digest/step.ts`. The same shape
 * backs the Telegram `/attention`, `kota attention` CLI, daemon HTTP
 * `GET /api/attention`, embedded web `AttentionPanel`, and macOS
 * `AttentionView` surfaces; the mobile AttentionScreen is the seventh.
 */
export interface AttentionItem {
  label: string;
  detail: string;
}

export interface AttentionResponse {
  data: { items: AttentionItem[] };
  text: string;
}
