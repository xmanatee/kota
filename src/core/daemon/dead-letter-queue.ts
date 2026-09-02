import type { EventSchemaReference } from "#core/events/event-bus.js";
import type { EventJsonObject } from "#core/events/event-journal.js";
import type {
  WorkflowBatchFlushPayload,
  WorkflowBatchFlushReason,
} from "#core/workflow/trigger-types.js";

export type DeadLetterItemType =
  | "event-envelope"
  | "batch-envelope"
  | "workflow-dispatch"
  | "confirmed-action-dispatch";

export type DeadLetterItemStatus = "open" | "dismissed" | "redriven";

export type DeadLetterFailureClass =
  | "validation"
  | "execution"
  | "schema"
  | "auth"
  | "provider"
  | "rate_limit"
  | "runtime"
  | "output_contract"
  | "unknown";

export type DeadLetterRedriveTarget = "original" | "simulation";

export type DeadLetterFailure = {
  reason: string;
  retryCount: number;
  lastErrorClass: DeadLetterFailureClass;
  firstFailedAt: string;
  lastFailedAt: string;
  /** One timestamp per represented failure observation for window-local metrics. */
  observationTimes?: string[];
  /** Provider incident horizon captured when workflow dispatch was parked. */
  backoffUntil?: string;
};

export type DeadLetterRetentionPolicy =
  | { kind: "retain" }
  | { kind: "expire-after-ms"; durationMs: number; expiresAt: string };

export type DeadLetterWorkflowDispatchSource = {
  kind: "workflow-dispatch";
  workflowName: string;
  triggerEvent: string;
  triggerSchemaRef: EventSchemaReference | null;
  failedRunId?: string;
  runDir?: string;
};

export type DeadLetterBatchSource = {
  kind: "batch-envelope";
  workflowName: string;
  triggerIndex: number;
  sourceEventName: string;
  groupingKey: string;
  inputEventCount: number;
  droppedInputCount: number;
};

export type DeadLetterEventSource = {
  kind: "event-envelope";
  eventName: string;
  eventJournalId?: string;
};

export type DeadLetterConfirmedActionSource = {
  kind: "confirmed-action-dispatch";
  decisionId: string;
  actionId: string;
  adapterName: string;
  workflowName?: string;
  runId?: string;
  stepId?: string;
};

export type DeadLetterSource =
  | DeadLetterWorkflowDispatchSource
  | DeadLetterBatchSource
  | DeadLetterEventSource
  | DeadLetterConfirmedActionSource;

export type DeadLetterWorkflowRedrive = {
  kind: "workflow";
  workflowName: string;
  source: DeadLetterWorkflowRedriveSource;
};

export type DeadLetterEventRedrive = {
  kind: "event";
  source: DeadLetterEventRedriveSource;
};

export type DeadLetterNoRedrive = {
  kind: "none";
  reason: string;
};

export type DeadLetterRedriveSource =
  | DeadLetterWorkflowRedrive
  | DeadLetterEventRedrive
  | DeadLetterNoRedrive;

export type DeadLetterWorkflowRedriveSource =
  | { kind: "run-trigger"; runId: string }
  | { kind: "event-journal"; eventId: string }
  | {
      kind: "batch-event-journal";
      triggerEvent: string;
      triggerSchemaRef: EventSchemaReference | null;
      payload: DeadLetterBatchRedrivePayload;
    }
  | { kind: "resume-step"; runId: string; stepId: string };

export type DeadLetterEventRedriveSource = {
  kind: "event-journal";
  eventId: string;
};

export type DeadLetterBatchRedrivePayload = {
  scopeId: string;
  sourceEventName: string;
  groupingKey: string;
  reason: WorkflowBatchFlushReason;
  count: number;
  window: WorkflowBatchFlushPayload["window"];
  inputEvents: DeadLetterBatchInputEventRef[];
  batch: WorkflowBatchFlushPayload["batch"];
};

export type DeadLetterBatchInputEventRef = {
  event: string;
  schemaRef: EventSchemaReference | null;
  eventId?: string;
  receivedAt: string;
};

export type DeadLetterRedriveAttempt = {
  target: DeadLetterRedriveTarget;
  reason: string;
  attemptedAt: string;
  result:
    | { status: "queued"; runId: string; workflowName: string }
    | { status: "emitted"; event: string }
    | { status: "simulated" }
    | { status: "failed"; message: string };
};

export type DeadLetterItem = {
  id: string;
  type: DeadLetterItemType;
  status: DeadLetterItemStatus;
  scopeId: string;
  owningModule: string;
  sourceEventIds: string[];
  affectedWorkflowNames: string[];
  failure: DeadLetterFailure;
  source: DeadLetterSource;
  redrive: DeadLetterRedriveSource;
  redactedProjection: EventJsonObject;
  createdAt: string;
  updatedAt: string;
  dismissedAt?: string;
  dismissalReason?: string;
  redriveAttempts: DeadLetterRedriveAttempt[];
  retention: DeadLetterRetentionPolicy;
};

export type DeadLetterQueueCounts = {
  open: number;
  dismissed: number;
  redriven: number;
};

export type DeadLetterQueueQuery = {
  status?: DeadLetterItemStatus;
  type?: DeadLetterItemType;
  scopeId?: string;
  workflowName?: string;
  limit?: number;
};

export type DeadLetterQueueRecordInput = {
  type: DeadLetterItemType;
  scopeId: string;
  owningModule: string;
  sourceEventIds: readonly string[];
  affectedWorkflowNames: readonly string[];
  failure: {
    reason: string;
    retryCount?: number;
    lastErrorClass: DeadLetterFailureClass;
    failedAt?: string;
    backoffUntil?: string;
  };
  source: DeadLetterSource;
  redrive: DeadLetterRedriveSource;
  redactedProjection: EventJsonObject;
  retention?: { kind: "retain" } | { kind: "expire-after-ms"; durationMs: number };
};

export {
  createBatchDeadLetter,
  createConfirmedActionDeadLetter,
  createEventEnvelopeDeadLetter,
  createWorkflowDispatchDeadLetter,
} from "./dead-letter-capture.js";
export {
  deadLetterDigest,
  toEventJsonObject,
} from "./dead-letter-policy.js";
export {
  DeadLetterQueueStore,
  deadLetterDuplicateFingerprint,
  deadLetterRunArtifactIds,
  deadLetterStoreForScope,
  deadLetterWorkflowName,
} from "./dead-letter-store.js";
