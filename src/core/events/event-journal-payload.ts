import {
  EVIDENCE_REDACTED,
  projectEvidenceJsonObject,
} from "#core/evidence/policy.js";
import type { BusEnvelope } from "./event-bus.js";
import type {
  EventEnvelope,
  EventEnvelopePayloadStorage,
  EventEnvelopeTraceContext,
  EventJsonObject,
  EventJsonValue,
} from "./event-journal-types.js";
import { getModuleEventRegistry } from "./module-event.js";
import type {
  ModuleEventPayloadSchema,
  ModuleEventSchemaNode,
} from "./module-event-schema.js";

export function payloadStorageToObject(
  storage: EventEnvelopePayloadStorage,
): EventJsonObject {
  if (storage.kind === "inline") return storage.payload;
  return {
    payloadPointer: storage.uri,
    contentType: storage.contentType,
    ...(storage.sha256 !== undefined ? { sha256: storage.sha256 } : {}),
  };
}

export function clonePayload(payload: BusEnvelope["payload"]): EventJsonObject {
  const serialized = JSON.stringify(payload);
  if (serialized === undefined) {
    throw new Error("Event payload cannot be serialized to JSON");
  }
  return JSON.parse(serialized) as EventJsonObject;
}

export function payloadForStorage(
  eventName: string,
  payload: EventJsonObject,
): EventJsonObject {
  const registration = getModuleEventRegistry()?.get(eventName);
  const schemaRedacted = registration
    ? redactObjectBySchema(payload, registration.payloadSchema)
    : payload;
  return projectEvidenceJsonObject(
    schemaRedacted,
    "internal-storage",
  );
}

export function redactedPayloadForClient(
  envelope: EventEnvelope,
): EventJsonObject {
  const payload = payloadStorageToObject(envelope.payload);
  const registration = getModuleEventRegistry()?.get(envelope.event.name);
  if (!registration) {
    return projectEvidenceJsonObject(payload, "daemon-api");
  }
  if (registration.sensitivity === "secret" || registration.sensitivity === "sensitive") {
    return { redacted: true, reason: "event-classification" };
  }
  return projectEvidenceJsonObject(
    redactObjectBySchema(payload, registration.payloadSchema),
    "daemon-api",
  );
}

export function readString(
  payload: BusEnvelope["payload"],
  key: string,
): string | undefined {
  const value = payload[key];
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

export function readNumber(
  payload: BusEnvelope["payload"],
  key: string,
): number | undefined {
  const value = payload[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function readTimestamp(
  payload: BusEnvelope["payload"],
  key: string,
): string | undefined {
  const value = readString(payload, key);
  return value !== undefined && Number.isFinite(Date.parse(value)) ? value : undefined;
}

export function readTraceContext(
  payload: BusEnvelope["payload"],
): EventEnvelopeTraceContext {
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
    out[key] = node
      ? redactValueByNode(value, node)
      : value === undefined
        ? value
        : (projectEvidenceJsonObject({ [key]: value }, "daemon-api")[
            key
          ] as EventJsonValue);
  }
  return out;
}

function redactValueByNode(
  value: EventJsonValue | undefined,
  node: ModuleEventSchemaNode,
): EventJsonValue | undefined {
  if (node.sensitivity === "secret" || node.sensitivity === "sensitive") {
    return EVIDENCE_REDACTED;
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
