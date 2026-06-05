import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { BusEnvelope, EventBus, EventSchemaReference } from "./event-bus.js";
import { getModuleEventRegistry } from "./module-event.js";
import type {
  ModuleEventPayloadSchema,
  ModuleEventSchemaNode,
  ModuleEventSensitivity,
} from "./module-event-schema.js";

export type EventJsonPrimitive = string | number | boolean | null;
export type EventJsonValue =
  | EventJsonPrimitive
  | EventJsonObject
  | EventJsonValue[];
export type EventJsonObject = { [key: string]: EventJsonValue | undefined };

export type EventEnvelopeScope =
  | { kind: "daemon" }
  | {
      kind: "scope";
      scopeId: string;
      projectId: string;
      lineage: readonly string[];
    };

export type EventEnvelopeSourceKind =
  | "channel"
  | "workflow"
  | "session"
  | "scheduler"
  | "module"
  | "daemon"
  | "external"
  | "unknown";

export type EventEnvelopeSource = {
  kind: EventEnvelopeSourceKind;
  id: string;
};

export type EventEnvelopeProducer =
  | {
      kind: "channel";
      provider: string;
      channel: string;
      accountId?: string;
      sourceId: string;
      externalId?: string;
    }
  | {
      kind: "workflow";
      workflow: string;
      runId: string;
      stepId?: string;
      definitionPath?: string;
    }
  | { kind: "session"; sessionId: string }
  | { kind: "scheduler"; itemId: number }
  | { kind: "module"; module: string }
  | { kind: "daemon" }
  | { kind: "external"; source: string }
  | { kind: "unknown" };

export type EventEnvelopeTimestamps = {
  occurredAt: string;
  receivedAt: string;
  emittedAt: string;
  journaledAt: string;
};

export type EventEnvelopeCausality = {
  correlationId?: string;
  causationId?: string;
  parentEventId?: string;
};

export type EventEnvelopeTraceContext = {
  traceparent?: string;
  tracestate?: string;
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
};

export type EventEnvelopeIdempotency = {
  idempotencyKey?: string;
  externalProviderId?: string;
};

export type EventEnvelopeDataPolicy = {
  classification: ModuleEventSensitivity;
  redactionProfile: "plain" | "redacted-client-projection";
};

export type EventEnvelopePayloadStorage =
  | { kind: "inline"; payload: EventJsonObject }
  | { kind: "pointer"; uri: string; contentType: string; sha256?: string };

export type EventEnvelopeRetention =
  | { kind: "retain" }
  | {
      kind: "expires";
      expiresAt: string;
      expiredBehavior: "exclude-from-query";
    };

export type EventEnvelope = {
  id: string;
  sequence: number;
  event: {
    name: string;
    schema: EventSchemaReference;
  };
  source: EventEnvelopeSource;
  scope: EventEnvelopeScope;
  timestamps: EventEnvelopeTimestamps;
  producer: EventEnvelopeProducer;
  causality: EventEnvelopeCausality;
  trace: EventEnvelopeTraceContext;
  idempotency: EventEnvelopeIdempotency;
  data: EventEnvelopeDataPolicy;
  payload: EventEnvelopePayloadStorage;
  retention: EventEnvelopeRetention;
};

export type EventJournalRetentionPolicy =
  | { kind: "retain" }
  | { kind: "expire-after-ms"; durationMs: number };

export type EventJournalOptions = {
  fileName?: string;
  retention?: EventJournalRetentionPolicy;
  now?: () => Date;
  scopeLineage?: (scopeId: string) => readonly string[];
};

export type EventJournalQuery = {
  id?: string;
  type?: string;
  typePrefix?: string;
  typeGlob?: string;
  scopeId?: string;
  sourceId?: string;
  sinceMs?: number;
  after?: string;
  limit?: number;
};

export type EventJournalClientProjection = {
  id: string;
  type: string;
  payload: EventJsonObject;
  timestamp: string;
  schemaRef: EventSchemaReference;
  scope: EventEnvelopeScope;
  source: EventEnvelopeSource;
  causationId?: string;
  correlationId?: string;
  parentEventId?: string;
  trace: EventEnvelopeTraceContext;
};

const DEFAULT_JOURNAL_FILE = "journal.jsonl";
const REDACTED = "[redacted]";
const SENSITIVE_PAYLOAD_KEY_PATTERN =
  /(authorization|credential|password|secret|token|api[-_]?key|access[-_]?key|refresh[-_]?token|cookie)/i;

export class EventJournal {
  private readonly filePath: string;
  private readonly retention: EventJournalRetentionPolicy;
  private readonly now: () => Date;
  private readonly scopeLineage: (scopeId: string) => readonly string[];
  private nextSequence: number;

  constructor(dir: string, options: EventJournalOptions = {}) {
    this.filePath = join(dir, options.fileName ?? DEFAULT_JOURNAL_FILE);
    this.retention = options.retention ?? { kind: "retain" };
    this.now = options.now ?? (() => new Date());
    this.scopeLineage = options.scopeLineage ?? ((scopeId) => [scopeId]);
    mkdirSync(dir, { recursive: true });
    this.nextSequence = this.readNextSequence();
  }

  getPath(): string {
    return this.filePath;
  }

  appendFromBusEnvelope(envelope: BusEnvelope): EventEnvelope {
    const journaledAt = this.now();
    const sequence = this.nextSequence;
    const record = buildEventEnvelope(
      envelope,
      sequence,
      journaledAt,
      this.retention,
      this.scopeLineage,
    );
    appendFileSync(this.filePath, `${JSON.stringify(record)}\n`, "utf-8");
    this.nextSequence = sequence + 1;
    return record;
  }

  appendEnvelope(envelope: EventEnvelope): EventEnvelope {
    appendFileSync(this.filePath, `${JSON.stringify(envelope)}\n`, "utf-8");
    this.nextSequence = Math.max(this.nextSequence, envelope.sequence + 1);
    return envelope;
  }

  query(query: EventJournalQuery = {}): EventEnvelope[] {
    let events = this.readAll();
    if (query.after !== undefined) {
      const cursorIndex = events.findIndex((event) => event.id === query.after);
      events = cursorIndex >= 0 ? events.slice(cursorIndex + 1) : [];
    }
    events = events.filter((event) => this.matches(event, query));
    if (query.limit !== undefined && query.limit > 0 && events.length > query.limit) {
      events = events.slice(events.length - query.limit);
    }
    return events;
  }

  replay(
    query: EventJournalQuery,
    handle: (envelope: BusEnvelope) => void,
  ): EventEnvelope[] {
    const events = this.query(query);
    for (const event of events) {
      handle(eventEnvelopeToBusEnvelope(event));
    }
    return events;
  }

  toClientProjection(envelope: EventEnvelope): EventJournalClientProjection {
    const causationId = envelope.causality.causationId;
    const correlationId = envelope.causality.correlationId;
    const parentEventId = envelope.causality.parentEventId;
    return {
      id: envelope.id,
      type: envelope.event.name,
      payload: redactedPayloadForClient(envelope),
      timestamp: envelope.timestamps.receivedAt,
      schemaRef: envelope.event.schema,
      scope: envelope.scope,
      source: envelope.source,
      ...(causationId !== undefined ? { causationId } : {}),
      ...(correlationId !== undefined ? { correlationId } : {}),
      ...(parentEventId !== undefined ? { parentEventId } : {}),
      trace: envelope.trace,
    };
  }

  private readNextSequence(): number {
    const events = this.readAll();
    if (events.length === 0) return 1;
    return Math.max(...events.map((event) => event.sequence)) + 1;
  }

  private readAll(): EventEnvelope[] {
    if (!existsSync(this.filePath)) return [];
    const content = readFileSync(this.filePath, "utf-8");
    const events: EventEnvelope[] = [];
    const lines = content.split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]!.trim();
      if (line.length === 0) continue;
      let parsed: EventEnvelope;
      try {
        parsed = JSON.parse(line) as EventEnvelope;
      } catch (error) {
        throw new Error(
          `${this.filePath}:${index + 1}: malformed event journal entry: ${String(error)}`,
        );
      }
      assertEventEnvelope(parsed, this.filePath, index + 1);
      events.push(parsed);
    }
    return events;
  }

  private matches(envelope: EventEnvelope, query: EventJournalQuery): boolean {
    if (isExpired(envelope, this.now().getTime())) return false;
    if (query.id !== undefined && envelope.id !== query.id) return false;
    if (query.type !== undefined && envelope.event.name !== query.type) return false;
    if (
      query.typePrefix !== undefined &&
      !envelope.event.name.startsWith(query.typePrefix)
    ) {
      return false;
    }
    if (
      query.typeGlob !== undefined &&
      !eventTypeMatchesGlob(envelope.event.name, query.typeGlob)
    ) {
      return false;
    }
    if (query.scopeId !== undefined) {
      if (envelope.scope.kind !== "scope" || envelope.scope.scopeId !== query.scopeId) {
        return false;
      }
    }
    if (query.sourceId !== undefined && envelope.source.id !== query.sourceId) {
      return false;
    }
    if (
      query.sinceMs !== undefined &&
      Date.parse(envelope.timestamps.receivedAt) <= query.sinceMs
    ) {
      return false;
    }
    return true;
  }
}

export function installEventJournal(
  bus: EventBus,
  journal: EventJournal,
): () => void {
  return bus.addEmitMiddleware((envelope, next) => {
    const durable = journal.appendFromBusEnvelope(envelope);
    envelope.eventId = durable.id;
    next();
  });
}

export function eventEnvelopeToBusEnvelope(envelope: EventEnvelope): BusEnvelope {
  return {
    type: envelope.event.name,
    schemaRef: envelope.event.schema,
    eventId: envelope.id,
    payload: payloadStorageToObject(envelope.payload),
  };
}

export function redactedPayloadForClient(
  envelope: EventEnvelope,
): EventJsonObject {
  const payload = payloadStorageToObject(envelope.payload);
  const registration = getModuleEventRegistry()?.get(envelope.event.name);
  if (!registration) return redactObjectByKey(payload);
  if (registration.sensitivity === "secret" || registration.sensitivity === "sensitive") {
    return { redacted: true, reason: "event-classification" };
  }
  return redactObjectBySchema(payload, registration.payloadSchema);
}

function buildEventEnvelope(
  envelope: BusEnvelope,
  sequence: number,
  journaledAt: Date,
  retention: EventJournalRetentionPolicy,
  scopeLineage: (scopeId: string) => readonly string[],
): EventEnvelope {
  const payload = clonePayload(envelope.payload);
  const schema = resolveEnvelopeSchema(envelope);
  const sourceAndProducer = resolveSourceAndProducer(envelope.type, envelope.payload);
  const journaledAtIso = journaledAt.toISOString();
  return {
    id: `evtj-${String(sequence).padStart(12, "0")}`,
    sequence,
    event: {
      name: envelope.type,
      schema,
    },
    source: sourceAndProducer.source,
    scope: resolveEnvelopeScope(envelope.payload, scopeLineage),
    timestamps: {
      occurredAt: readTimestamp(envelope.payload, "occurredAt") ?? readTimestamp(envelope.payload, "startedAt") ?? readTimestamp(envelope.payload, "completedAt") ?? readTimestamp(envelope.payload, "timestamp") ?? journaledAtIso,
      receivedAt: readTimestamp(envelope.payload, "receivedAt") ?? journaledAtIso,
      emittedAt: journaledAtIso,
      journaledAt: journaledAtIso,
    },
    producer: sourceAndProducer.producer,
    causality: {
      ...(readString(envelope.payload, "correlationId") !== undefined
        ? { correlationId: readString(envelope.payload, "correlationId") }
        : {}),
      ...(readString(envelope.payload, "causationId") !== undefined
        ? { causationId: readString(envelope.payload, "causationId") }
        : {}),
      ...(readString(envelope.payload, "parentEventId") !== undefined
        ? { parentEventId: readString(envelope.payload, "parentEventId") }
        : {}),
    },
    trace: readTraceContext(envelope.payload),
    idempotency: {
      ...(readString(envelope.payload, "idempotencyKey") !== undefined
        ? { idempotencyKey: readString(envelope.payload, "idempotencyKey") }
        : {}),
      ...(readString(envelope.payload, "externalId") !== undefined
        ? { externalProviderId: readString(envelope.payload, "externalId") }
        : {}),
    },
    data: dataPolicyForEvent(envelope.type),
    payload: { kind: "inline", payload },
    retention: resolveRetention(retention, journaledAt),
  };
}

function resolveEnvelopeSchema(envelope: BusEnvelope): EventSchemaReference {
  if (envelope.schemaRef) return envelope.schemaRef;
  const registered = getModuleEventRegistry()?.get(envelope.type);
  if (registered) {
    return { name: registered.name, version: registered.currentVersion };
  }
  return { name: envelope.type, version: 1 };
}

function resolveEnvelopeScope(
  payload: BusEnvelope["payload"],
  scopeLineage: (scopeId: string) => readonly string[],
): EventEnvelopeScope {
  const scopeId = readString(payload, "scopeId");
  const projectId = readString(payload, "projectId");
  if (scopeId !== undefined && projectId !== undefined && scopeId !== projectId) {
    throw new Error(
      `Event envelope scope conflict: scopeId=${scopeId}, projectId=${projectId}`,
    );
  }
  const resolved = scopeId ?? projectId;
  if (resolved === undefined) return { kind: "daemon" };
  return {
    kind: "scope",
    scopeId: resolved,
    projectId: resolved,
    lineage: scopeLineage(resolved),
  };
}

function resolveSourceAndProducer(
  eventName: string,
  payload: BusEnvelope["payload"],
): { source: EventEnvelopeSource; producer: EventEnvelopeProducer } {
  const provider = readString(payload, "provider");
  const channel = readString(payload, "channel");
  const sourceId = readString(payload, "sourceId");
  if (provider !== undefined && channel !== undefined && sourceId !== undefined) {
    const accountId = readString(payload, "accountId");
    const externalId = readString(payload, "externalId");
    return {
      source: {
        kind: "channel",
        id: [
          provider,
          channel,
          accountId ?? "default",
          sourceId,
          externalId ?? "unknown",
        ].join(":"),
      },
      producer: {
        kind: "channel",
        provider,
        channel,
        ...(accountId !== undefined ? { accountId } : {}),
        sourceId,
        ...(externalId !== undefined ? { externalId } : {}),
      },
    };
  }

  const workflow = readString(payload, "workflow");
  const runId = readString(payload, "runId");
  if (workflow !== undefined && runId !== undefined) {
    const stepId = readString(payload, "stepId");
    const definitionPath = readString(payload, "definitionPath");
    return {
      source: { kind: "workflow", id: `workflow:${workflow}:${runId}` },
      producer: {
        kind: "workflow",
        workflow,
        runId,
        ...(stepId !== undefined ? { stepId } : {}),
        ...(definitionPath !== undefined ? { definitionPath } : {}),
      },
    };
  }

  const sessionId = readString(payload, "sessionId");
  if (sessionId !== undefined) {
    return {
      source: { kind: "session", id: `session:${sessionId}` },
      producer: { kind: "session", sessionId },
    };
  }

  const itemId = readNumber(payload, "itemId");
  if (itemId !== undefined) {
    return {
      source: { kind: "scheduler", id: `schedule:${itemId}` },
      producer: { kind: "scheduler", itemId },
    };
  }

  const registration = getModuleEventRegistry()?.get(eventName);
  if (registration) {
    return {
      source: { kind: "module", id: `module:${registration.module}` },
      producer: { kind: "module", module: registration.module },
    };
  }

  if (eventName.startsWith("daemon.") || eventName.startsWith("runtime.")) {
    return {
      source: { kind: "daemon", id: "daemon" },
      producer: { kind: "daemon" },
    };
  }

  const source = readString(payload, "source");
  if (source !== undefined) {
    return {
      source: { kind: "external", id: source },
      producer: { kind: "external", source },
    };
  }

  return {
    source: { kind: "unknown", id: eventName },
    producer: { kind: "unknown" },
  };
}

function dataPolicyForEvent(eventName: string): EventEnvelopeDataPolicy {
  const classification = getModuleEventRegistry()?.get(eventName)?.sensitivity ?? "internal";
  return {
    classification,
    redactionProfile:
      classification === "public" ? "plain" : "redacted-client-projection",
  };
}

function resolveRetention(
  retention: EventJournalRetentionPolicy,
  journaledAt: Date,
): EventEnvelopeRetention {
  if (retention.kind === "retain") return { kind: "retain" };
  return {
    kind: "expires",
    expiresAt: new Date(journaledAt.getTime() + retention.durationMs).toISOString(),
    expiredBehavior: "exclude-from-query",
  };
}

function isExpired(envelope: EventEnvelope, nowMs: number): boolean {
  return (
    envelope.retention.kind === "expires" &&
    Date.parse(envelope.retention.expiresAt) <= nowMs
  );
}

function payloadStorageToObject(storage: EventEnvelopePayloadStorage): EventJsonObject {
  if (storage.kind === "inline") return storage.payload;
  return {
    payloadPointer: storage.uri,
    contentType: storage.contentType,
    ...(storage.sha256 !== undefined ? { sha256: storage.sha256 } : {}),
  };
}

function clonePayload(payload: BusEnvelope["payload"]): EventJsonObject {
  const serialized = JSON.stringify(payload);
  if (serialized === undefined) {
    throw new Error("Event payload cannot be serialized to JSON");
  }
  return JSON.parse(serialized) as EventJsonObject;
}

function readString(
  payload: BusEnvelope["payload"],
  key: string,
): string | undefined {
  const value = payload[key];
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

function readNumber(
  payload: BusEnvelope["payload"],
  key: string,
): number | undefined {
  const value = payload[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readTimestamp(
  payload: BusEnvelope["payload"],
  key: string,
): string | undefined {
  const value = readString(payload, key);
  return value !== undefined && Number.isFinite(Date.parse(value)) ? value : undefined;
}

function readTraceContext(payload: BusEnvelope["payload"]): EventEnvelopeTraceContext {
  const traceContextValue = payload.traceContext;
  const traceContext = isPayloadObject(traceContextValue) ? traceContextValue : payload;
  return {
    ...(readString(traceContext, "traceparent") !== undefined
      ? { traceparent: readString(traceContext, "traceparent") }
      : {}),
    ...(readString(traceContext, "tracestate") !== undefined
      ? { tracestate: readString(traceContext, "tracestate") }
      : {}),
    ...(readString(traceContext, "traceId") !== undefined
      ? { traceId: readString(traceContext, "traceId") }
      : {}),
    ...(readString(traceContext, "spanId") !== undefined
      ? { spanId: readString(traceContext, "spanId") }
      : {}),
    ...(readString(traceContext, "parentSpanId") !== undefined
      ? { parentSpanId: readString(traceContext, "parentSpanId") }
      : {}),
  };
}

function isPayloadObject(
  value: BusEnvelope["payload"][string],
): value is BusEnvelope["payload"] {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function redactObjectBySchema(
  payload: EventJsonObject,
  schema: ModuleEventPayloadSchema,
): EventJsonObject {
  const out: EventJsonObject = {};
  for (const [key, value] of Object.entries(payload)) {
    const node = schema.properties[key];
    out[key] = node ? redactValueByNode(value, node) : redactValueByKey(value, key);
  }
  return out;
}

function redactValueByNode(
  value: EventJsonValue | undefined,
  node: ModuleEventSchemaNode,
): EventJsonValue | undefined {
  if (node.sensitivity === "secret" || node.sensitivity === "sensitive") {
    return REDACTED;
  }
  if (value === undefined || value === null) return value;
  if (node.type === "array") {
    return Array.isArray(value)
      ? value.map((item) => redactValueByNode(item, node.items) ?? null)
      : value;
  }
  if (node.type === "object") {
    return isEventJsonObject(value) ? redactObjectBySchema(value, node) : value;
  }
  if (node.type === "discriminatedUnion") {
    if (!isEventJsonObject(value)) return value;
    const discriminator = value[node.discriminator];
    const variant =
      typeof discriminator === "string" ? node.variants[discriminator] : undefined;
    return variant ? redactObjectBySchema(value, variant) : value;
  }
  return value;
}

function isEventJsonObject(value: EventJsonValue): value is EventJsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function redactObjectByKey(payload: EventJsonObject): EventJsonObject {
  const out: EventJsonObject = {};
  for (const [key, value] of Object.entries(payload)) {
    out[key] = redactValueByKey(value, key);
  }
  return out;
}

function redactValueByKey(
  value: EventJsonValue | undefined,
  key = "",
): EventJsonValue | undefined {
  if (value === undefined) return value;
  if (SENSITIVE_PAYLOAD_KEY_PATTERN.test(key)) return REDACTED;
  if (Array.isArray(value)) return value.map((entry) => redactValueByKey(entry) ?? null);
  if (!isEventJsonObject(value)) return value;
  return redactObjectByKey(value);
}

function eventTypeMatchesGlob(eventType: string, glob: string): boolean {
  const segments = glob.split("*");
  const prefix = segments[0] ?? "";
  if (prefix !== "" && !eventType.startsWith(prefix)) return false;

  let offset = prefix.length;
  const suffix = segments[segments.length - 1] ?? "";
  for (let index = 1; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    if (segment === "") continue;
    const foundAt = eventType.indexOf(segment, offset);
    if (foundAt === -1) return false;
    offset = foundAt + segment.length;
  }

  if (suffix === "") return true;
  const suffixStart = eventType.length - suffix.length;
  return suffixStart >= offset && eventType.endsWith(suffix);
}

function assertEventEnvelope(
  envelope: EventEnvelope,
  path: string,
  lineNumber: number,
): void {
  if (
    typeof envelope.id !== "string" ||
    !envelope.id.trim() ||
    typeof envelope.sequence !== "number" ||
    !Number.isInteger(envelope.sequence) ||
    envelope.sequence < 1 ||
    typeof envelope.event?.name !== "string" ||
    !envelope.event.name.trim() ||
    typeof envelope.event.schema?.name !== "string" ||
    typeof envelope.event.schema?.version !== "number" ||
    !Number.isInteger(envelope.event.schema.version) ||
    envelope.event.schema.version < 1 ||
    typeof envelope.payload !== "object" ||
    envelope.payload === null ||
    (envelope.payload.kind !== "inline" && envelope.payload.kind !== "pointer")
  ) {
    throw new Error(`${path}:${lineNumber}: malformed event journal envelope`);
  }
}
