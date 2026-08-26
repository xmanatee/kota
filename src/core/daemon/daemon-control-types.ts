import type { AgentUsage } from "#core/agent-harness/usage.js";
import type { ChannelStatus } from "#core/channels/channel.js";
import type {
  EventSchemaReference,
} from "#core/events/event-bus-types.js";
import type {
  ModuleEventCompatibilityPolicy,
  ModuleEventPayloadExample,
  ModuleEventPayloadSchema,
  ModuleEventScope,
  ModuleEventSensitivity,
  ModuleEventWorkflowTriggerPolicy,
} from "#core/events/module-event.js";
import type { AutonomyMode } from "#core/tools/autonomy-mode.js";
import type { GuardrailsSnapshot } from "#core/tools/guardrails.js";
import type { WorkflowDispatchPauseStatus } from "#core/workflow/dispatch-pause-types.js";
import type {
  ToolCallSummaryEntry,
  WorkflowActiveRun,
  WorkflowQueuedRun,
  WorkflowRuntimeSummary,
  WorkflowStepSkipReason,
} from "#core/workflow/run-types.js";
import type { WorkflowAgentBackoffState } from "#core/workflow/trigger-types.js";
import type { DaemonState } from "./daemon-state.js";
import type {
  DeadLetterItem,
  DeadLetterItemStatus,
  DeadLetterItemType,
  DeadLetterQueueCounts,
  DeadLetterRedriveTarget,
} from "./dead-letter-queue.js";
import type { ScopeHostingState } from "./scope-lifecycle-types.js";
import type { ScopeId } from "./scope-registry.js";

export type {
  DaemonSseEvent,
  DaemonSseEventType,
  DaemonSseStreamEvent,
  DaemonTimelineEvent,
  QueueChangedPayload,
} from "./daemon-control-events.js";
export type { DaemonControlHandle } from "./daemon-control-handle.js";

/**
 * Typed wire-shape for the daemon's "unknown scopeId" rejection on a
 * scope-bound route. Built by `daemon-control-utils` when the route
 * validates `?scopeId=` and the id does not match a configured directory
 * scope.
 */
export type UnknownScopeError = {
  error: "Unknown scope";
  reason: "unknown_scope";
  scopeId: string;
};

export type ConflictingScopeSelectorsError = {
  error: "Conflicting scope selectors";
  reason: "conflicting_scope_selectors";
  requestedScopeId: string;
  boundScopeId: string;
};

export type ScopeNotHostedError = {
  error: "Scope is not hosted";
  reason: "scope_not_hosted";
  scopeId: string;
};

/**
 * Result of {@link DaemonControlHandle.setActiveScopeId}. The success
 * arm carries the new active selection (echoing the requested value back
 * so callers don't need a follow-up read); the rejection arm names the
 * unknown id so route handlers can 404 with the typed shape.
 */
export type SetActiveScopeResult =
  | { ok: true; activeScopeId: ScopeId | null }
  | { ok: false; reason: "not_found"; scopeId: string }
  | {
      ok: false;
      reason: "not_hosted";
      scopeId: string;
      state: Exclude<ScopeHostingState, "hosted">;
    };

export type RegisterSessionResult =
  | { ok: true; scopeId: ScopeId }
  | {
      ok: false;
      reason: "scope_not_hosted";
      scopeId: ScopeId;
      state: Exclude<ScopeHostingState, "hosted">;
    };

export type {
  ChannelStatus,
  DeadLetterItem,
  DeadLetterItemStatus,
  DeadLetterItemType,
  DeadLetterQueueCounts,
  DeadLetterRedriveTarget,
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
  /** Present only when a runtime override differs from the static source `enabled` value. */
  runtimeEnabled?: boolean;
  stepCount: number;
  triggers: WorkflowDefinitionTriggerSummary[];
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
};

export type EventSchemaSummary = {
  name: string;
  module: string;
  scope: ModuleEventScope;
  currentVersion: number;
  fields: readonly string[];
  filterablePaths: readonly string[];
  sensitivity: ModuleEventSensitivity;
  compatibility: ModuleEventCompatibilityPolicy;
  workflowTriggerPolicy: ModuleEventWorkflowTriggerPolicy;
};

export type EventSchemaDetail = EventSchemaSummary & {
  payloadSchema: ModuleEventPayloadSchema;
  examples: readonly ModuleEventPayloadExample[];
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
  agentBackoff?: WorkflowAgentBackoffState;
  definitionsLoadedAt?: string;
  workflows: WorkflowRuntimeSummary["workflows"];
  paused: boolean;
  pause?: WorkflowDispatchPauseStatus;
  /** True when a dispatchWindow is configured and the current time is outside it. */
  dispatchWindowBlocked?: boolean;
  /** ISO timestamp of the next time the dispatch window opens (when blocked). */
  dispatchWindowOpensAt?: string;
  /** Daemon-wide top-level automation concurrency limit. */
  concurrency: number;
};

export type WorkflowResumeOptions = {
  retryAgent?: boolean;
};

export type DaemonLiveStatus = DaemonState & {
  running: boolean;
  workflow: WorkflowLiveStatus;
  sessions: InteractiveSession[];
  channels: ChannelStatus[];
};

export type WorkflowRunSummary = {
  id: string;
  workflow: string;
  status: string;
  triggerEvent: string;
  triggerSchemaRef: EventSchemaReference | null;
  startedAt: string;
  durationMs?: number;
  usage?: AgentUsage;
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
  usage?: AgentUsage;
  toolCalls?: ToolCallSummaryEntry[];
  skipReason?: WorkflowStepSkipReason;
};

export type WorkflowRunDetail = WorkflowRunSummary & {
  completedAt?: string;
  triggerPayload?: Record<string, unknown>;
  steps: WorkflowRunStepSummary[];
  warnings?: Array<{ type: string; message: string }>;
};

export type InteractiveSession = {
  id: string;
  scopeId: ScopeId;
  createdAt: string;
  lastActive: number;
  /** Operator supervision mode the session runs under. */
  autonomyMode: AutonomyMode;
  /** Present for daemon-owned live AgentSession instances. */
  guardrailsSnapshot?: GuardrailsSnapshot;
  /** "serve" = registered from kota serve; "daemon" = owned by daemon control API. */
  source?: "daemon" | "serve";
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
  deadLetterCounts: DeadLetterQueueCounts;
};

export type DeadLetterQueueListOptions = {
  status?: DeadLetterItemStatus;
  type?: DeadLetterItemType;
  workflowName?: string;
  limit?: number;
  scopeId?: ScopeId;
};

export type DeadLetterQueueListResult = {
  items: DeadLetterItem[];
  counts: DeadLetterQueueCounts;
};

export type DeadLetterQueueMutationResult =
  | { ok: true; item: DeadLetterItem; runId?: string; workflowName?: string; event?: string }
  | {
      ok: false;
      reason: "not_found" | "not_redrivable" | "unknown_workflow" | "admission_rejected";
    };

export type {
  ComponentStatus,
  HealthStatus,
  ModuleHealthCheckResult,
} from "./daemon-health-types.js";
