export function processProtocolBatch(envelope) {
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
    throw new TypeError("envelope must be an object");
  }
  const window = envelope.window;
  if (!window || typeof window !== "object" || Array.isArray(window)) {
    throw new TypeError("window must be an object");
  }
  if (!Number.isInteger(window.start) || !Number.isInteger(window.end)) {
    throw new TypeError("window bounds must be integers");
  }
  if (window.start >= window.end) {
    throw new RangeError("window.start must be less than window.end");
  }

  const accepted = [];
  const rejected = [];
  const events = Array.isArray(envelope.events) ? envelope.events : [];
  for (const event of events) {
    if (!event || typeof event !== "object" || Array.isArray(event)) {
      rejected.push({ reason: "invalid-event" });
      continue;
    }
    if (typeof event.id !== "string" || event.id.trim().length === 0) {
      rejected.push({ id: event.id, reason: "invalid-id" });
      continue;
    }
    if (!Number.isInteger(event.timestamp)) {
      rejected.push({ id: event.id, reason: "invalid-timestamp" });
      continue;
    }
    if (!event.payload || typeof event.payload !== "object" || Array.isArray(event.payload)) {
      rejected.push({ id: event.id, reason: "invalid-payload" });
      continue;
    }
    if (event.timestamp < window.start || event.timestamp > window.end) {
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

  return {
    accepted,
    rejected,
    stats: {
      accepted: accepted.length,
      rejected: rejected.length,
    },
  };
}
