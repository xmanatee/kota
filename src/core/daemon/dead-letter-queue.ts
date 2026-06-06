import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  BusEnvelope,
  EventSchemaReference,
} from "#core/events/event-bus.js";
import type {
  EventEnvelope,
  EventJsonObject,
  EventJsonValue,
} from "#core/events/event-journal.js";
import { redactedPayloadForClient } from "#core/events/event-journal.js";
import { writeJsonFileAtomic } from "#core/util/json-file.js";
import type { WorkflowRunMetadata } from "#core/workflow/run-types.js";
import type {
  WorkflowBatchFlushPayload,
  WorkflowBatchFlushReason,
  WorkflowRunTrigger,
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
  | "unknown";

export type DeadLetterRedriveTarget = "original" | "simulation";

export type DeadLetterFailure = {
  reason: string;
  retryCount: number;
  lastErrorClass: DeadLetterFailureClass;
  firstFailedAt: string;
  lastFailedAt: string;
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

export type DeadLetterEventRedriveSource =
  | { kind: "event-journal"; eventId: string };

export type DeadLetterBatchRedrivePayload = {
  scopeId: string;
  projectId: string;
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
  projectId: string;
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
  projectId: string;
  owningModule: string;
  sourceEventIds: readonly string[];
  affectedWorkflowNames: readonly string[];
  failure: {
    reason: string;
    retryCount?: number;
    lastErrorClass: DeadLetterFailureClass;
    failedAt?: string;
  };
  source: DeadLetterSource;
  redrive: DeadLetterRedriveSource;
  redactedProjection: EventJsonObject;
  retention?: { kind: "retain" } | { kind: "expire-after-ms"; durationMs: number };
};

type DeadLetterQueueSnapshot = {
  items: DeadLetterItem[];
};

const STORE_FILE = "items.json";
const DEFAULT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const SENSITIVE_KEY_PATTERN =
  /(authorization|credential|password|secret|token|api[-_]?key|access[-_]?key|refresh[-_]?token|cookie)/i;

export class DeadLetterQueueStore {
  private readonly filePath: string;

  constructor(
    private readonly dir: string,
    private readonly now: () => Date = () => new Date(),
  ) {
    mkdirSync(dir, { recursive: true });
    this.filePath = join(dir, STORE_FILE);
  }

  getPath(): string {
    return this.filePath;
  }

  list(query: DeadLetterQueueQuery = {}): DeadLetterItem[] {
    let items = this.readSnapshot().items.filter((item) => !this.isExpired(item));
    if (query.status !== undefined) {
      items = items.filter((item) => item.status === query.status);
    }
    if (query.type !== undefined) {
      items = items.filter((item) => item.type === query.type);
    }
    if (query.scopeId !== undefined) {
      items = items.filter((item) => item.scopeId === query.scopeId);
    }
    if (query.workflowName !== undefined) {
      const workflowName = query.workflowName;
      items = items.filter((item) => item.affectedWorkflowNames.includes(workflowName));
    }
    items = items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    if (query.limit !== undefined && query.limit > 0 && items.length > query.limit) {
      return items.slice(0, query.limit);
    }
    return items;
  }

  counts(scopeId?: string): DeadLetterQueueCounts {
    const counts: DeadLetterQueueCounts = { open: 0, dismissed: 0, redriven: 0 };
    for (const item of this.list(scopeId === undefined ? {} : { scopeId })) {
      counts[item.status] += 1;
    }
    return counts;
  }

  get(id: string): DeadLetterItem | null {
    return this.list().find((item) => item.id === id) ?? null;
  }

  record(input: DeadLetterQueueRecordInput): DeadLetterItem {
    const now = input.failure.failedAt ?? this.now().toISOString();
    const item: DeadLetterItem = {
      id: `dlq-${randomUUID()}`,
      type: input.type,
      status: "open",
      scopeId: input.scopeId,
      projectId: input.projectId,
      owningModule: input.owningModule,
      sourceEventIds: [...input.sourceEventIds],
      affectedWorkflowNames: [...input.affectedWorkflowNames],
      failure: {
        reason: input.failure.reason,
        retryCount: input.failure.retryCount ?? 1,
        lastErrorClass: input.failure.lastErrorClass,
        firstFailedAt: now,
        lastFailedAt: now,
      },
      source: input.source,
      redrive: input.redrive,
      redactedProjection: input.redactedProjection,
      createdAt: now,
      updatedAt: now,
      redriveAttempts: [],
      retention: resolveRetention(input.retention, new Date(now)),
    };
    const snapshot = this.readSnapshot();
    snapshot.items.push(item);
    this.writeSnapshot(snapshot);
    return item;
  }

  dismiss(id: string, reason: string): DeadLetterItem | null {
    const snapshot = this.readSnapshot();
    const index = snapshot.items.findIndex((item) => item.id === id);
    if (index === -1) return null;
    const now = this.now().toISOString();
    const item = snapshot.items[index]!;
    const next: DeadLetterItem = {
      ...item,
      status: "dismissed",
      dismissedAt: now,
      dismissalReason: reason,
      updatedAt: now,
    };
    snapshot.items[index] = next;
    this.writeSnapshot(snapshot);
    return next;
  }

  recordRedriveAttempt(
    id: string,
    attempt: Omit<DeadLetterRedriveAttempt, "attemptedAt">,
  ): DeadLetterItem | null {
    const snapshot = this.readSnapshot();
    const index = snapshot.items.findIndex((item) => item.id === id);
    if (index === -1) return null;
    const now = this.now().toISOString();
    const item = snapshot.items[index]!;
    const next: DeadLetterItem = {
      ...item,
      status: attempt.result.status === "failed" ? item.status : "redriven",
      updatedAt: now,
      redriveAttempts: [
        ...item.redriveAttempts,
        {
          ...attempt,
          attemptedAt: now,
        },
      ],
    };
    snapshot.items[index] = next;
    this.writeSnapshot(snapshot);
    return next;
  }

  diagnostics(id: string): EventJsonObject | null {
    const item = this.get(id);
    if (!item) return null;
    return toEventJsonObject({
      item,
      exportedAt: this.now().toISOString(),
      storePath: this.filePath,
    });
  }

  private readSnapshot(): DeadLetterQueueSnapshot {
    if (!existsSync(this.filePath)) return { items: [] };
    return JSON.parse(readFileSync(this.filePath, "utf-8")) as DeadLetterQueueSnapshot;
  }

  private writeSnapshot(snapshot: DeadLetterQueueSnapshot): void {
    mkdirSync(this.dir, { recursive: true });
    writeJsonFileAtomic(this.filePath, snapshot);
  }

  private isExpired(item: DeadLetterItem): boolean {
    return (
      item.retention.kind === "expire-after-ms" &&
      Date.parse(item.retention.expiresAt) <= this.now().getTime()
    );
  }
}

export function createWorkflowDispatchDeadLetter(input: {
  store: DeadLetterQueueStore;
  scopeId: string;
  workflowName: string;
  trigger: WorkflowRunTrigger;
  reason: string;
  errorClass: DeadLetterFailureClass;
  failedRun?: WorkflowRunMetadata;
  retryCount?: number;
  owningModule?: string;
}): DeadLetterItem {
  const projection = workflowTriggerProjection(input.workflowName, input.trigger);
  const failedRunId = input.failedRun?.id;
  const redrive =
    failedRunId !== undefined
      ? workflowRedrive(input.workflowName, { kind: "run-trigger", runId: failedRunId })
      : input.trigger.eventId !== undefined
        ? workflowRedrive(input.workflowName, {
            kind: "event-journal",
            eventId: input.trigger.eventId,
          })
        : {
            kind: "none" as const,
            reason: "workflow dispatch redrive requires a failed run or journaled trigger event",
          };
  return input.store.record({
    type: "workflow-dispatch",
    scopeId: input.scopeId,
    projectId: input.scopeId,
    owningModule: input.owningModule ?? "workflow-runtime",
    sourceEventIds: sourceEventIdsFromTrigger(input.trigger),
    affectedWorkflowNames: [input.workflowName],
    failure: {
      reason: input.reason,
      retryCount: input.retryCount,
      lastErrorClass: input.errorClass,
      failedAt: input.failedRun?.completedAt,
    },
    source: {
      kind: "workflow-dispatch",
      workflowName: input.workflowName,
      triggerEvent: input.trigger.event,
      triggerSchemaRef: input.trigger.schemaRef,
      ...(failedRunId !== undefined ? { failedRunId } : {}),
      ...(input.failedRun?.runDir !== undefined ? { runDir: input.failedRun.runDir } : {}),
    },
    redrive,
    redactedProjection: projection,
  });
}

export function createBatchDeadLetter(input: {
  store: DeadLetterQueueStore;
  scopeId: string;
  payload: WorkflowBatchFlushPayload;
  reason: string;
  errorClass: DeadLetterFailureClass;
  trigger: WorkflowRunTrigger;
}): DeadLetterItem {
  const inputEvents = input.payload.inputEvents.map((event) => ({
    event: event.event,
    schemaRef: event.schemaRef,
    ...(event.eventId !== undefined ? { eventId: event.eventId } : {}),
    receivedAt: event.receivedAt,
  }));
  const everyInputEventJournaled = inputEvents.every((event) => event.eventId !== undefined);
  return input.store.record({
    type: "batch-envelope",
    scopeId: input.scopeId,
    projectId: input.scopeId,
    owningModule: "workflow-runtime",
    sourceEventIds: sourceEventIdsFromBatch(input.payload),
    affectedWorkflowNames: [input.payload.batch.workflow],
    failure: {
      reason: input.reason,
      lastErrorClass: input.errorClass,
    },
    source: {
      kind: "batch-envelope",
      workflowName: input.payload.batch.workflow,
      triggerIndex: input.payload.batch.triggerIndex,
      sourceEventName: input.payload.sourceEventName,
      groupingKey: input.payload.groupingKey,
      inputEventCount: input.payload.inputEvents.length,
      droppedInputCount: input.payload.batch.droppedInputCount,
    },
    redrive: everyInputEventJournaled
      ? workflowRedrive(input.payload.batch.workflow, {
          kind: "batch-event-journal",
          triggerEvent: input.trigger.event,
          triggerSchemaRef: input.trigger.schemaRef,
          payload: {
            scopeId: input.payload.scopeId,
            projectId: input.payload.projectId,
            sourceEventName: input.payload.sourceEventName,
            groupingKey: input.payload.groupingKey,
            reason: input.payload.reason,
            count: input.payload.count,
            window: input.payload.window,
            inputEvents,
            batch: input.payload.batch,
          },
        })
      : {
          kind: "none",
          reason: "batch redrive requires every input event to have a journal id",
        },
    redactedProjection: redactJsonObject(toEventJsonObject(input.payload)),
  });
}

type EventEnvelopeDeadLetterInputBase = {
  store: DeadLetterQueueStore;
  scopeId: string;
  reason: string;
  errorClass: DeadLetterFailureClass;
  redriveEnvelope?: BusEnvelope;
  owningModule?: string;
};

type JournaledEventEnvelopeDeadLetterInput = EventEnvelopeDeadLetterInputBase & {
  envelope: EventEnvelope;
};

type UnjournaledEventEnvelopeDeadLetterInput = EventEnvelopeDeadLetterInputBase & {
  eventName: string;
  schemaRef: EventSchemaReference | null;
  payload: BusEnvelope["payload"];
};

export function createEventEnvelopeDeadLetter(
  input: JournaledEventEnvelopeDeadLetterInput | UnjournaledEventEnvelopeDeadLetterInput,
): DeadLetterItem {
  const journaled = "envelope" in input;
  const eventName = journaled ? input.envelope.event.name : input.eventName;
  const eventJournalId = journaled ? input.envelope.id : undefined;
  const redriveEventId = eventJournalId ?? input.redriveEnvelope?.eventId;
  return input.store.record({
    type: "event-envelope",
    scopeId: input.scopeId,
    projectId: input.scopeId,
    owningModule: input.owningModule ?? "event-runtime",
    sourceEventIds: eventJournalId !== undefined ? [eventJournalId] : [],
    affectedWorkflowNames: [],
    failure: {
      reason: input.reason,
      lastErrorClass: input.errorClass,
    },
    source: {
      kind: "event-envelope",
      eventName,
      ...(eventJournalId !== undefined ? { eventJournalId } : {}),
    },
    redrive: redriveEventId !== undefined
      ? { kind: "event", source: { kind: "event-journal", eventId: redriveEventId } }
      : { kind: "none", reason: "event redrive requires the event journal" },
    redactedProjection: journaled
      ? redactedPayloadForClient(input.envelope)
      : redactJsonObject(toEventJsonObject(input.payload)),
  });
}

export function createConfirmedActionDeadLetter(input: {
  store: DeadLetterQueueStore;
  scopeId: string;
  decisionId: string;
  actionId: string;
  adapterName: string;
  reason: string;
  workflowName?: string;
  runId?: string;
  stepId?: string;
  redactedInput: EventJsonObject;
}): DeadLetterItem {
  const affected = input.workflowName !== undefined ? [input.workflowName] : [];
  const redrive =
    input.workflowName !== undefined &&
    input.runId !== undefined &&
    input.stepId !== undefined
      ? workflowRedrive(input.workflowName, {
          kind: "resume-step",
          runId: input.runId,
          stepId: input.stepId,
        })
      : {
          kind: "none" as const,
          reason: "confirmed action redrive requires source workflow run and step ids",
        };
  return input.store.record({
    type: "confirmed-action-dispatch",
    scopeId: input.scopeId,
    projectId: input.scopeId,
    owningModule: input.adapterName,
    sourceEventIds: [],
    affectedWorkflowNames: affected,
    failure: {
      reason: input.reason,
      lastErrorClass: "execution",
    },
    source: {
      kind: "confirmed-action-dispatch",
      decisionId: input.decisionId,
      actionId: input.actionId,
      adapterName: input.adapterName,
      ...(input.workflowName !== undefined ? { workflowName: input.workflowName } : {}),
      ...(input.runId !== undefined ? { runId: input.runId } : {}),
      ...(input.stepId !== undefined ? { stepId: input.stepId } : {}),
    },
    redrive,
    redactedProjection: redactJsonObject(input.redactedInput),
  });
}

export function deadLetterStoreForProject(projectDir: string): DeadLetterQueueStore {
  return new DeadLetterQueueStore(join(projectDir, ".kota", "dead-letter-queue"));
}

export function deadLetterRunArtifactIds(projectDir: string): {
  itemIds: string[];
  runIds: string[];
} {
  const deadLetterDir = join(projectDir, ".kota", "dead-letter-queue");
  const deadLetterFile = join(deadLetterDir, STORE_FILE);
  const itemIds = existsSync(deadLetterFile)
    ? new DeadLetterQueueStore(deadLetterDir).list({ status: "open" }).map((item) => item.id)
    : [];
  const runsDir = join(projectDir, ".kota", "runs");
  const runIds: string[] = [];
  if (existsSync(runsDir)) {
    for (const name of readdirSync(runsDir)) {
      if (!name.includes("redrive")) continue;
      runIds.push(name);
    }
  }
  return { itemIds, runIds };
}

export function toEventJsonObject(value: object): EventJsonObject {
  return JSON.parse(JSON.stringify(value)) as EventJsonObject;
}

function workflowTriggerProjection(
  workflowName: string,
  trigger: WorkflowRunTrigger,
): EventJsonObject {
  return redactJsonObject(
    toEventJsonObject({
      workflowName,
      triggerEvent: trigger.event,
      triggerSchemaRef: trigger.schemaRef,
      triggerPayload: trigger.payload,
    }),
  );
}

function sourceEventIdsFromTrigger(trigger: WorkflowRunTrigger): string[] {
  const ids = new Set<string>();
  if (trigger.eventId !== undefined) ids.add(trigger.eventId);
  const payloadEventId = trigger.payload.eventId;
  if (typeof payloadEventId === "string" && payloadEventId.length > 0) {
    ids.add(payloadEventId);
  }
  const inputEvents = trigger.payload.inputEvents;
  if (Array.isArray(inputEvents)) {
    for (const item of inputEvents) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const eventId = "eventId" in item ? item.eventId : undefined;
      if (typeof eventId === "string" && eventId.length > 0) ids.add(eventId);
    }
  }
  return [...ids];
}

function sourceEventIdsFromBatch(payload: WorkflowBatchFlushPayload): string[] {
  return payload.inputEvents.flatMap((event) =>
    event.eventId !== undefined ? [event.eventId] : [],
  );
}

function resolveRetention(
  retention: DeadLetterQueueRecordInput["retention"],
  now: Date,
): DeadLetterRetentionPolicy {
  const policy = retention ?? {
    kind: "expire-after-ms" as const,
    durationMs: DEFAULT_RETENTION_MS,
  };
  if (policy.kind === "retain") return policy;
  return {
    ...policy,
    expiresAt: new Date(now.getTime() + policy.durationMs).toISOString(),
  };
}

function redactJsonObject(value: EventJsonObject): EventJsonObject {
  const out: EventJsonObject = {};
  for (const [key, entry] of Object.entries(value)) {
    out[key] = redactJsonValue(entry, key);
  }
  return out;
}

function redactJsonValue(
  value: EventJsonValue | undefined,
  key = "",
): EventJsonValue | undefined {
  if (value === undefined) return value;
  if (SENSITIVE_KEY_PATTERN.test(key)) return "[redacted]";
  if (Array.isArray(value)) return value.map((entry) => redactJsonValue(entry) ?? null);
  if (value === null || typeof value !== "object") return value;
  return redactJsonObject(value);
}

export function deadLetterDigest(value: EventJsonObject): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function workflowRedrive(
  workflowName: string,
  source: DeadLetterWorkflowRedriveSource,
): DeadLetterWorkflowRedrive {
  return {
    kind: "workflow",
    workflowName,
    source,
  };
}
