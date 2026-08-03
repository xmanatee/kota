import type { EventEnvelope } from "./event-journal-types.js";

export function assertEventEnvelope(
  envelope: EventEnvelope,
  path: string,
  location: number | string,
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
    throw new Error(`${path}:${location}: malformed event journal envelope`);
  }
}
