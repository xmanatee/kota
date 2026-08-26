import type { EvidenceDataClass, EvidenceSensitivity } from "#core/evidence/policy.js";
import type { EventSchemaReference } from "./event-bus.js";
import type { ModuleEventSensitivity } from "./module-event-schema.js";

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
  /** Stable identity supplied by the workflow outbox for retry-safe delivery. */
  eventId?: string;
  idempotencyKey?: string;
  externalProviderId?: string;
};

export type EventEnvelopeDataPolicy = {
  classification: ModuleEventSensitivity;
  sensitivity: EvidenceSensitivity;
  dataClasses: readonly EvidenceDataClass[];
  redactionProfile: "plain" | "redacted-client-projection";
  storageProfile: "internal-storage";
};

export type EventEnvelopePayloadStorage =
  | { kind: "inline"; payload: EventJsonObject }
  | { kind: "pointer"; uri: string; contentType: string; sha256?: string };

export type EventEnvelopeRetention =
  | { kind: "retain" }
  | {
      kind: "expires";
      expiresAt: string;
      expiredBehavior: "exclude-from-query" | "metadata-reference";
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
