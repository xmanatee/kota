import type { BusEnvelope } from "./event-bus.js";
import { payloadStorageToObject, redactedPayloadForClient } from "./event-journal-payload.js";
import type {
  EventEnvelope,
  EventJournalClientProjection,
} from "./event-journal-types.js";

export function eventEnvelopeToBusEnvelope(envelope: EventEnvelope): BusEnvelope {
  return {
    type: envelope.event.name,
    schemaRef: envelope.event.schema,
    eventId: envelope.id,
    payload: payloadStorageToObject(envelope.payload),
  };
}

export function toEventJournalClientProjection(
  envelope: EventEnvelope,
): EventJournalClientProjection {
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
