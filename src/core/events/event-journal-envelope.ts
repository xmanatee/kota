import {
  type EvidenceSensitivity,
  evidencePolicyForArtifact,
} from "#core/evidence/policy.js";
import type { BusEnvelope, EventSchemaReference } from "./event-bus.js";
import {
  clonePayload,
  payloadForStorage,
  readNumber,
  readString,
  readTimestamp,
  readTraceContext,
} from "./event-journal-payload.js";
import type {
  EventEnvelope,
  EventEnvelopeDataPolicy,
  EventEnvelopeProducer,
  EventEnvelopeRetention,
  EventEnvelopeScope,
  EventEnvelopeSource,
  EventJournalRetentionPolicy,
} from "./event-journal-types.js";
import { getModuleEventRegistry } from "./module-event.js";
import type { ModuleEventSensitivity } from "./module-event-schema.js";

export function buildEventEnvelope(
  envelope: BusEnvelope,
  sequence: number,
  journaledAt: Date,
  retention: EventJournalRetentionPolicy,
  scopeLineage: (scopeId: string) => readonly string[],
): EventEnvelope {
  const rawPayload = clonePayload(envelope.payload);
  const payload = payloadForStorage(envelope.type, rawPayload);
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
      occurredAt:
        readTimestamp(envelope.payload, "occurredAt") ??
        readTimestamp(envelope.payload, "startedAt") ??
        readTimestamp(envelope.payload, "completedAt") ??
        readTimestamp(envelope.payload, "timestamp") ??
        journaledAtIso,
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
      ...(envelope.delivery === "outbox" && envelope.eventId !== undefined
        ? { eventId: envelope.eventId }
        : {}),
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
  if (scopeId === undefined) return { kind: "daemon" };
  return {
    kind: "scope",
    scopeId,
    lineage: scopeLineage(scopeId),
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
  const classification =
    getModuleEventRegistry()?.get(eventName)?.sensitivity ?? "internal";
  const artifactPolicy = evidencePolicyForArtifact("event-envelope");
  return {
    classification,
    sensitivity: eventSensitivityToEvidenceSensitivity(classification),
    dataClasses: artifactPolicy.dataClasses,
    redactionProfile:
      classification === "public" ? "plain" : "redacted-client-projection",
    storageProfile: "internal-storage",
  };
}

function eventSensitivityToEvidenceSensitivity(
  sensitivity: ModuleEventSensitivity,
): EvidenceSensitivity {
  switch (sensitivity) {
    case "public":
      return "public";
    case "internal":
      return "internal";
    case "sensitive":
      return "sensitive";
    case "secret":
      return "secret";
  }
}

function resolveRetention(
  retention: EventJournalRetentionPolicy,
  journaledAt: Date,
): EventEnvelopeRetention {
  if (retention.kind === "retain") return { kind: "retain" };
  return {
    kind: "expires",
    expiresAt: new Date(journaledAt.getTime() + retention.durationMs).toISOString(),
    expiredBehavior: "metadata-reference",
  };
}
