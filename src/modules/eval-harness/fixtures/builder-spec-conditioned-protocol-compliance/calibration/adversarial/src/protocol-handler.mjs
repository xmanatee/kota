export function processProtocolBatch(envelope) {
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
    throw new TypeError("envelope must be an object");
  }
  if (envelope.schemaVersion !== 1) {
    throw new TypeError("schemaVersion must be 1");
  }
  if (envelope.window.start >= envelope.window.end) {
    throw new RangeError("window.start must be less than window.end");
  }
  const accepted = [];
  const rejected = [];
  for (const event of envelope.events) {
    if (typeof event.id !== "string" || event.id.trim().length === 0) {
      rejected.push({ id: event.id, reason: "invalid-id" });
      continue;
    }
    if (!event.payload || typeof event.payload !== "object" || Array.isArray(event.payload)) {
      rejected.push({ id: event.id, reason: "invalid-payload" });
      continue;
    }
    if (event.timestamp < envelope.window.start || event.timestamp > envelope.window.end) {
      rejected.push({ id: event.id, reason: "outside-window" });
      continue;
    }
    accepted.push({
      id: event.id,
      canonicalId: event.id,
      timestamp: event.timestamp,
      sequence: Number.isInteger(event.sequence) ? event.sequence : 0,
      payload: event.payload,
    });
  }
  return { accepted, rejected, stats: { accepted: accepted.length, rejected: rejected.length } };
}
