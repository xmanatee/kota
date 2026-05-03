/**
 * Capability readiness types — kept in sync with the daemon's
 * `CapabilityReadiness` shape (see
 * `src/core/daemon/capability-readiness.ts`).
 */
export type CapabilityStatus = "ready" | "unavailable" | "init_failed";

export type CapabilityReadiness = {
  id: string;
  moduleName: string;
  status: CapabilityStatus;
  reason?: string;
  message?: string;
  meta?: Record<string, string | number | boolean>;
};

export type CapabilityReadinessSummary = {
  ready: number;
  unavailable: number;
  init_failed: number;
};

export type CapabilityReadinessResponse = {
  capabilities: CapabilityReadiness[];
  summary: CapabilityReadinessSummary;
};

/** Stable capability id every client agrees on for the embedded dashboard. */
export const DASHBOARD_CAPABILITY_ID = "dashboard";
/** Stable capability id the daemon registers for workflow triggering. */
export const WORKFLOW_TRIGGER_CAPABILITY_ID = "workflow.trigger";

/**
 * Identity payload — kept in sync with the daemon's `ClientIdentity`
 * shape (see `src/core/daemon/client-identity.ts`).
 */
export type ClientDashboardAvailability =
  | { available: true; path: string }
  | { available: false; reason: string; message?: string };

export type ClientIdentity = {
  projectName: string;
  projectDir: string;
  daemonVersion: string;
  pid: number;
  startedAt: string;
  dashboard: ClientDashboardAvailability;
};

/**
 * Daemon error envelope shared by every thin-client decoder. Mirrors
 * the typed shape `parseDaemonClientErrorBody` returns.
 */
export type DaemonClientErrorBody = {
  error?: string;
  code?: string;
  reason?: string;
  message?: string;
  raw?: string;
};

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
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
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

/**
 * Cross-client wire-contract types — re-exported from the shared
 * conformance decoders in `clients/conformance/decoders.ts`. Production
 * `api.*` paths run those decoders at the boundary, mirroring the macOS
 * Swift Codable and mobile parse* runtime posture: unknown discriminator
 * values throw `ContractDecodeError` instead of silently coercing the
 * payload into a typed-but-invalid object.
 */
export { ContractDecodeError } from "../../../conformance/decoders";

export type {
  AnswerCitation,
  AnswerHistoryEntry,
  AnswerHistoryListResult,
  AnswerHistoryRecord,
  AnswerHistoryShowResult,
  AnswerResult,
  AttentionItem,
  AttentionResponse,
  CaptureRecord,
  CaptureResult,
  CaptureTarget,
  DigestData,
  DigestQueueCounts,
  DigestQueueDelta,
  DigestResponse,
  HistorySearchResponse,
  KnowledgeSearchResponse,
  MemorySearchResponse,
  RecallAnswerHit,
  RecallAnswerHitResult,
  RecallHistoryHit,
  RecallHit,
  RecallKnowledgeHit,
  RecallMemoryHit,
  RecallResult,
  RecallSource,
  RecallTasksHit,
  RetractRecord,
  RetractResult,
  RetractTarget,
  TasksSearchResponse,
} from "../../../conformance/decoders";

import type {
  CaptureTarget,
  RecallSource,
  RetractTarget,
} from "../../../conformance/decoders";

/**
 * Request-side filter the panel passes to `api.answer`. The response
 * shape's `filter.sources` arrives as `string[]` from the daemon, but the
 * request side sends a typed `RecallSource[]` so the picker can only
 * propose known sources.
 */
export type AnswerFilter = {
  topK?: number;
  minScore?: number;
  sources?: RecallSource[];
};

export type AnswerHistoryListFilter = {
  limit?: number;
  beforeId?: string;
};

export type CaptureFilter = {
  target?: CaptureTarget;
  hint?: string;
};

export type RetractRequest =
  | { target: "memory"; id: string }
  | { target: "knowledge"; slug: string }
  | { target: "tasks"; id: string }
  | { target: "inbox"; path: string };

/**
 * Stable contributor ordering used by the seam to render `suggestions`
 * deterministically. The web client mirrors the seam's `CAPTURE_TARGET_ORDER`
 * so the override control's option order matches what the seam returns.
 */
export const CAPTURE_TARGET_ORDER: ReadonlyArray<CaptureTarget> = [
  "memory",
  "knowledge",
  "tasks",
  "inbox",
] as const;

/**
 * Stable retract-target ordering. Mirrors the seam's `RETRACT_TARGET_ORDER`
 * so the panel's picker option order matches the agent and CLI surfaces.
 */
export const RETRACT_TARGET_ORDER: ReadonlyArray<RetractTarget> = [
  "memory",
  "knowledge",
  "tasks",
  "inbox",
] as const;

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
