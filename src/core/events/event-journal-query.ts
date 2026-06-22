import type {
  EventEnvelope,
  EventJournalQuery,
} from "./event-journal-types.js";

export function envelopeAvailableForQuery(
  envelope: EventEnvelope,
  query: EventJournalQuery,
  nowMs: number,
): boolean {
  return !isExpired(envelope, nowMs) && envelopeMatchesQuery(envelope, query);
}

export function envelopeMatchesQuery(
  envelope: EventEnvelope,
  query: EventJournalQuery,
): boolean {
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

export function hasMetadataReferenceAfterExpiry(
  envelope: EventEnvelope,
  nowMs: number,
): boolean {
  return (
    envelope.retention.kind === "expires" &&
    envelope.retention.expiredBehavior === "metadata-reference" &&
    Date.parse(envelope.retention.expiresAt) <= nowMs
  );
}

function isExpired(envelope: EventEnvelope, nowMs: number): boolean {
  return (
    envelope.retention.kind === "expires" &&
    Date.parse(envelope.retention.expiresAt) <= nowMs
  );
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
