import type { BusEnvelope, BusEvents } from "#core/events/event-bus.js";

export const WORKFLOW_BATCH_FLUSH_EVENT = "workflow.batch.flushed";

export type WorkflowRetryConfig = {
  maxAttempts: number;
  initialDelayMs: number;
  backoffFactor: number;
};

export type WorkflowAgentBackoffKind = "rate_limit" | "auth" | "provider";

export type WorkflowAgentBackoffState = {
  kind: WorkflowAgentBackoffKind;
  failureCount: number;
  until: string;
  updatedAt: string;
  reason: string;
};

export type WorkflowAgentBackoffSignal = {
  kind: WorkflowAgentBackoffKind;
  reason: string;
};

export type WorkflowFilterScalar = string | number | boolean;
export type WorkflowFilterValue =
  | WorkflowFilterScalar
  | readonly WorkflowFilterScalar[];

export type WorkflowBatchFlushReason =
  | "count"
  | "max-age"
  | "idle-timeout"
  | "manual"
  | "overflow";

export type WorkflowBatchOverflowPolicy = "drop-newest" | "flush-oldest";

export type WorkflowBatchTriggerInput = {
  maxCount?: number;
  maxAgeMs?: number;
  idleTimeoutMs?: number;
  groupBy?: string | readonly string[];
  flushEvent?: string;
  maxBufferSize: number;
  overflow: WorkflowBatchOverflowPolicy;
};

export type WorkflowBatchTrigger = {
  maxCount?: number;
  maxAgeMs?: number;
  idleTimeoutMs?: number;
  groupBy: readonly string[];
  flushEvent?: string;
  maxBufferSize: number;
  overflow: WorkflowBatchOverflowPolicy;
};

export type WorkflowBatchGroupValue = {
  field: string;
  value: string;
};

export type WorkflowBatchInputEventEnvelope = {
  event: string;
  receivedAt: string;
  payload: BusEnvelope["payload"];
};

export type WorkflowBatchBufferState = {
  definitionName: string;
  triggerIndex: number;
  sourceEventName: string;
  scopeId: string;
  projectId: string;
  groupingKey: string;
  groupValues: readonly WorkflowBatchGroupValue[];
  firstEventAt: string;
  lastEventAt: string;
  inputEvents: WorkflowBatchInputEventEnvelope[];
  droppedInputCount: number;
};

export type WorkflowBatchBuffers = Record<string, WorkflowBatchBufferState>;

export type WorkflowBatchFlushPayload = {
  scopeId: string;
  projectId: string;
  sourceEventName: string;
  groupingKey: string;
  reason: WorkflowBatchFlushReason;
  count: number;
  window: {
    firstEventAt: string;
    lastEventAt: string;
    flushedAt: string;
  };
  inputEvents: WorkflowBatchInputEventEnvelope[];
  batch: {
    workflow: string;
    triggerIndex: number;
    maxBufferSize: number;
    overflow: WorkflowBatchOverflowPolicy;
    droppedInputCount: number;
  };
};

export type WorkflowTriggerInput = {
  event?: keyof BusEvents | string;
  filter?: Record<string, WorkflowFilterValue>;
  batch?: WorkflowBatchTriggerInput;
  cooldownMs?: number;
  /** Standard 5-field cron expression (MIN HOUR DOM MONTH DOW). */
  schedule?: string;
  /**
   * IANA timezone name for cron schedule evaluation (e.g. `"America/Los_Angeles"`).
   * When set, the cron expression is evaluated in the named timezone's wall-clock
   * time, so the workflow fires at the correct local time across daylight saving
   * transitions. When omitted, the process local timezone is used.
   * Only valid when `schedule` is also set.
   */
  timezone?: string;
  /** Interval in milliseconds. Fires immediately on first run, then every N ms. */
  intervalMs?: number;
  /**
   * When true, this trigger fires when the daemon receives a signed HTTP POST
   * to `POST /webhooks/:workflowName`. Secret is configured in daemon config
   * under `webhooks.<workflowName>.secret`.
   */
  webhook?: boolean;
  /**
   * Glob pattern (or array of patterns) to watch. When matching files change,
   * the workflow is queued with a `files.changed` event payload listing the
   * affected paths. Only active when the daemon is running.
   */
  watch?: string | string[];
  /**
   * Debounce delay in milliseconds for watch triggers. Minimum 200ms. Defaults
   * to 500ms.
   */
  debounceMs?: number;
};

export type WorkflowTrigger = {
  event: string;
  filter?: Record<string, WorkflowFilterValue>;
  batch?: WorkflowBatchTrigger;
  cooldownMs: number;
  /** Standard 5-field cron expression, if this is a schedule trigger. */
  schedule?: string;
  /** IANA timezone for cron evaluation. Omitted means process local timezone. */
  timezone?: string;
  /** Interval in milliseconds, if this is an interval trigger. */
  intervalMs?: number;
  /** When true, this trigger fires via the daemon webhook endpoint. */
  webhook?: boolean;
  /** Glob patterns for file-watch triggers. */
  watch?: string[];
  /** Debounce delay in milliseconds for watch triggers. */
  debounceMs?: number;
};

export type WorkflowRunTrigger = {
  event: string;
  payload: Record<string, unknown>;
};
