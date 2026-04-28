export type WorkflowDefinitionTriggerSummary =
  | { type: "event"; event: string; filter?: Record<string, string | string[]> }
  | { type: "cron"; schedule: string }
  | { type: "interval"; intervalMs: number }
  | { type: "webhook" }
  | { type: "watch"; patterns: string[]; debounceMs: number };

export type WorkflowDefinitionSummary = {
  name: string;
  enabled: boolean;
  runtimeEnabled?: boolean;
  stepCount: number;
  triggers: WorkflowDefinitionTriggerSummary[];
};

export type WorkflowActiveRun = {
  runId: string;
  workflow: string;
  startedAt: string;
  currentStep?: string;
};

export type WorkflowQueuedRun = {
  runId: string;
  workflowName: string;
};

export type WorkflowLiveStatus = {
  activeRuns: WorkflowActiveRun[];
  pendingRuns: WorkflowQueuedRun[];
  queueLength: number;
  completedRuns: number;
  totalCostUsd?: number;
  paused: boolean;
  dispatchWindowBlocked?: boolean;
  dispatchWindowOpensAt?: string;
  agentConcurrency: number;
  codeConcurrency: number;
  workflows: Record<string, { enabled: boolean }>;
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
  toolCalls?: Array<{ tool: string; count: number }>;
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
  counts: {
    inbox: number;
    ready: number;
    backlog: number;
    doing: number;
    blocked: number;
  };
  tasks: {
    doing: DaemonTaskDetail[];
    ready: DaemonTaskDetail[];
    backlog: DaemonTaskDetail[];
    blocked: DaemonTaskDetail[];
  };
};

export type AutonomyMode = "passive" | "supervised" | "autonomous";

export type InteractiveSession = {
  id: string;
  createdAt: string;
  lastActive: number;
  autonomyMode: AutonomyMode;
  source?: "daemon" | "serve";
};

export type ConversationRecord = {
  id: string;
  title?: string;
  createdAt: string;
  messageCount: number;
};

export type ConversationMessage = {
  role: "user" | "assistant";
  content: string | Array<{ type: string; text?: string }>;
};

export type ConversationData = {
  id: string;
  messages: ConversationMessage[];
};

export type PendingApproval = {
  id: string;
  runId: string;
  workflow: string;
  stepId: string;
  tool: string;
  input: Record<string, unknown>;
  requestedAt: string;
  status: "pending" | "approved" | "rejected";
  note?: string;
  reason?: string;
};

export type OwnerQuestionStatus =
  | "pending"
  | "answered"
  | "dismissed"
  | "expired";

export type PendingOwnerQuestion = {
  id: string;
  seq: number;
  context: string;
  question: string;
  reason: string;
  source: string;
  createdAt: string;
  status: OwnerQuestionStatus;
  proposedAnswers?: string[];
  resolvedAt?: string;
  answer?: string;
  dismissalReason?: string;
  timeoutMs?: number;
  defaultResolution?: "dismiss" | "answer";
  defaultAnswer?: string;
  resolutionSource?: string;
};

export type HealthStatus = {
  status: string;
  version: string;
  uptimeMs: number;
  components: {
    scheduler: string;
    modules: string;
    moduleHealthChecks?: Record<string, { status: string; message?: string }>;
  };
};

export type DaemonLiveStatus = {
  running: boolean;
  startedAt: string;
  workflow: WorkflowLiveStatus;
  sessions: InteractiveSession[];
};

export type ModuleInfo = {
  name: string;
  version: string;
  description: string;
  health?: { status: string; message?: string };
};

export type KnowledgeEntry = {
  id: string;
  title: string;
  category: string;
  content: string;
  createdAt: string;
};

export type MemoryEntry = {
  id: string;
  key: string;
  value: string;
  createdAt: string;
  updatedAt: string;
};

export type AuditEntry = {
  id: string;
  timestamp: string;
  tool: string;
  risk: "safe" | "moderate" | "dangerous";
  policy: "allow" | "confirm" | "deny" | "queue";
  input?: Record<string, unknown>;
  runId?: string;
};

export type ScheduleEntry = {
  id: string;
  description: string;
  triggerAt: string;
  repeatLabel?: string;
};

export type CostSummary = {
  totalCostUsd: number;
  workflows: Array<{ workflow: string; costUsd: number }>;
};

export type DigestBuilderCommitItem = {
  runId: string;
  taskId: string | null;
  taskTitle: string | null;
  commitSubject: string;
  durationMs: number | null;
};

export type DigestExplorerAdditionItem = {
  runId: string;
  taskCount: number;
  watchlistAdds: number;
};

export type DigestDecomposerSplitItem = {
  runId: string;
  parentTaskId: string | null;
  childTaskCount: number;
};

export type DigestBlockedPromoterMoveItem = {
  runId: string;
  promotedTaskIds: string[];
  toReady: string[];
  toBacklog: string[];
};

export type DigestFailedRunItem = {
  runId: string;
  workflow: string;
  status: "failed" | "interrupted";
  startedAt: string;
};

export type DigestPendingOwnerQuestionItem = {
  id: string;
  question: string;
  source: string;
  ageDays: number;
};

export type DigestAgingOperatorCaptureItem = {
  taskId: string;
  ageDays: number;
  path: string;
};

export type DigestQueueCounts = {
  backlog: number;
  ready: number;
  doing: number;
  blocked: number;
};

export type DigestQueueDelta = {
  current: DigestQueueCounts;
  previous: DigestQueueCounts | null;
  delta: { [K in keyof DigestQueueCounts]: number | null };
};

export type DailyDigestData = {
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
};

export type DigestResponse = {
  data: DailyDigestData;
  text: string;
};

export type AttentionItem = {
  label: string;
  detail: string;
};

export type AttentionResponse = {
  data: { items: AttentionItem[] };
  text: string;
};

/**
 * Cross-store recall types — kept in sync with the daemon's
 * `RecallResult` discriminated union (see
 * `src/core/server/kota-client.ts`).
 */
export type RecallSource = "knowledge" | "memory" | "history" | "tasks";

export type RecallKnowledgeHit = {
  source: "knowledge";
  score: number;
  id: string;
  title: string;
  preview: string;
  updated: string;
};

export type RecallMemoryHit = {
  source: "memory";
  score: number;
  id: string;
  preview: string;
  created: string;
};

export type RecallHistoryHit = {
  source: "history";
  score: number;
  id: string;
  title: string;
  cwd: string;
  updatedAt: string;
};

export type RecallTasksHit = {
  source: "tasks";
  score: number;
  id: string;
  title: string;
  state: string;
  priority: string;
  updatedAt: string;
};

export type RecallHit =
  | RecallKnowledgeHit
  | RecallMemoryHit
  | RecallHistoryHit
  | RecallTasksHit;

export type RecallResult =
  | { ok: true; hits: RecallHit[] }
  | { ok: false; reason: "semantic_unavailable" };

/**
 * Cited-answer types — kept in sync with the daemon's `AnswerResult`
 * discriminated union (see `src/core/server/kota-client.ts`).
 */
export type AnswerCitation = {
  source: RecallSource;
  id: string;
};

export type AnswerResult =
  | {
      ok: true;
      answer: string;
      citations: AnswerCitation[];
      hits: RecallHit[];
    }
  | {
      ok: false;
      reason: "no_hits" | "semantic_unavailable" | "synthesis_failed";
    };

export type AnswerFilter = {
  topK?: number;
  minScore?: number;
  sources?: RecallSource[];
};

export type AnswerHistoryRecord = {
  id: string;
  createdAt: string;
  query: string;
  filter: AnswerFilter;
  recallHits: RecallHit[];
  result: AnswerResult;
};

export type AnswerHistoryEntry = {
  id: string;
  createdAt: string;
  query: string;
  result:
    | { ok: true; citationCount: number }
    | {
        ok: false;
        reason: "no_hits" | "semantic_unavailable" | "synthesis_failed";
      };
};

export type AnswerHistoryListFilter = {
  limit?: number;
  beforeId?: string;
};

export type AnswerHistoryListResult = {
  entries: AnswerHistoryEntry[];
};

export type AnswerHistoryShowResult =
  | { ok: true; record: AnswerHistoryRecord }
  | { ok: false; reason: "not_found" };

export type SlashCommandSource = "workflow" | "skill";

export type SlashCommand = {
  name: string;
  label: string;
  description?: string;
  source: SlashCommandSource;
  module: string;
};

export type SlashCommandInvocation =
  | { kind: "workflow"; queued: string; runId?: string }
  | { kind: "skill"; prompt: string };

export type DaemonSseEventType =
  | "workflow.started"
  | "workflow.completed"
  | "workflow.step.completed"
  | "queue.changed"
  | "approval.changed"
  | "task.changed"
  | "session.registered"
  | "session.unregistered"
  | "workflow.failure.alert"
  | "owner.question.asked"
  | "owner.question.changed"
  | "owner.question.resolved"
  | "owner.question.dismissed"
  | "owner.question.expired";
