const SUPPORTED_EXTENSIONS = new Set(["basic", "priority"]);

function assertEnvelope(envelope) {
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
    throw new TypeError("envelope must be an object");
  }
  if (envelope.schemaVersion !== 1) {
    throw new TypeError("schemaVersion must be 1");
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
  if (!Array.isArray(envelope.events)) {
    throw new TypeError("events must be an array");
  }
  return window;
}

function normalizeId(id) {
  return id.trim().toLowerCase();
}

function validateRequires(event) {
  if (event.requires === undefined) return null;
  if (!Array.isArray(event.requires)) return "unsupported-extension";
  for (const extension of event.requires) {
    if (typeof extension !== "string" || !SUPPORTED_EXTENSIONS.has(extension)) {
      return "unsupported-extension";
    }
  }
  return null;
}

function selectedEvent(event, canonicalId, order) {
  return {
    id: event.id,
    canonicalId,
    timestamp: event.timestamp,
    sequence: Number.isInteger(event.sequence) ? event.sequence : 0,
    payload: event.payload,
    order,
  };
}

export function processProtocolBatch(envelope) {
  const window = assertEnvelope(envelope);
  const selected = new Map();
  const rejected = [];

  for (const [order, event] of envelope.events.entries()) {
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
    if (event.timestamp < window.start || event.timestamp >= window.end) {
      rejected.push({ id: event.id, reason: "outside-window" });
      continue;
    }
    const extensionIssue = validateRequires(event);
    if (extensionIssue !== null) {
      rejected.push({ id: event.id, reason: extensionIssue });
      continue;
    }

    const canonicalId = normalizeId(event.id);
    const candidate = selectedEvent(event, canonicalId, order);
    const previous = selected.get(canonicalId);
    if (previous === undefined || candidate.sequence > previous.sequence) {
      if (previous !== undefined) {
        rejected.push({ id: previous.id, reason: "duplicate-lower-sequence" });
      }
      selected.set(canonicalId, candidate);
      continue;
    }
    rejected.push({ id: event.id, reason: "duplicate-lower-sequence" });
  }

  const accepted = [...selected.values()]
    .sort((left, right) => left.order - right.order)
    .map(({ order: _order, ...event }) => event);

  return {
    accepted,
    rejected,
    stats: {
      accepted: accepted.length,
      rejected: rejected.length,
    },
  };
}
