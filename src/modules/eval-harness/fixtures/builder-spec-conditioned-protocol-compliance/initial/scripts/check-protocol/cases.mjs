import assert from "node:assert/strict";

function acceptedById(result, canonicalId) {
  return result.accepted.find((entry) => entry.canonicalId === canonicalId);
}

function rejectedReason(result, id) {
  return result.rejected.find((entry) => entry.id === id)?.reason;
}

export const genericCases = [
  {
    name: "rejects malformed envelope",
    clauseIds: ["WEP-1"],
    run: (handler) => {
      assert.throws(() => handler(null), /envelope/i);
      assert.throws(
        () => handler({ schemaVersion: 2, window: { start: 1, end: 2 }, events: [] }),
        /schemaVersion/i,
      );
    },
  },
  {
    name: "rejects invalid event shape",
    clauseIds: ["WEP-1"],
    run: (handler) => {
      const result = handler({
        schemaVersion: 1,
        window: { start: 10, end: 20 },
        events: [
          { id: "bad-payload", timestamp: 12, payload: null },
          { id: "", timestamp: 12, payload: { ok: true } },
        ],
      });
      assert.deepEqual(
        result.rejected.map((entry) => entry.reason).sort(),
        ["invalid-id", "invalid-payload"],
      );
      assert.equal(result.accepted.length, 0);
    },
  },
  {
    name: "accepts simple in-window event",
    clauseIds: ["WEP-1", "WEP-2"],
    run: (handler) => {
      const result = handler({
        schemaVersion: 1,
        window: { start: 10, end: 20 },
        events: [{ id: "simple", timestamp: 15, payload: { ok: true } }],
      });
      assert.equal(result.accepted.length, 1);
      assert.equal(result.accepted[0].canonicalId, "simple");
      assert.equal(result.rejected.length, 0);
    },
  },
];

export const specDependentCases = [
  {
    name: "exclusive end boundary",
    clauseIds: ["WEP-2"],
    run: (handler) => {
      const result = handler({
        schemaVersion: 1,
        window: { start: 10, end: 20 },
        events: [
          { id: "start-boundary", timestamp: 10, payload: { edge: "start" } },
          { id: "end-boundary", timestamp: 20, payload: { edge: "end" } },
        ],
      });
      assert.equal(acceptedById(result, "start-boundary")?.payload.edge, "start");
      assert.equal(rejectedReason(result, "end-boundary"), "outside-window");
    },
  },
  {
    name: "canonical id and highest sequence wins",
    clauseIds: ["WEP-3", "WEP-4"],
    run: (handler) => {
      const result = handler({
        schemaVersion: 1,
        window: { start: 100, end: 200 },
        events: [
          { id: " Device-7 ", timestamp: 110, sequence: 1, payload: { version: "old" } },
          { id: "device-7", timestamp: 111, sequence: 3, payload: { version: "new" } },
          { id: "DEVICE-7", timestamp: 112, sequence: 2, payload: { version: "middle" } },
        ],
      });
      assert.equal(result.accepted.length, 1);
      assert.equal(result.accepted[0].canonicalId, "device-7");
      assert.equal(result.accepted[0].sequence, 3);
      assert.equal(result.accepted[0].payload.version, "new");
    },
  },
  {
    name: "required extension gate",
    clauseIds: ["WEP-5"],
    run: (handler) => {
      const result = handler({
        schemaVersion: 1,
        window: { start: 1, end: 9 },
        events: [
          { id: "priority-kept", timestamp: 2, requires: ["priority"], payload: { ok: true } },
          { id: "archive-rejected", timestamp: 3, requires: ["archive"], payload: { ok: true } },
        ],
      });
      assert.equal(acceptedById(result, "priority-kept")?.payload.ok, true);
      assert.equal(rejectedReason(result, "archive-rejected"), "unsupported-extension");
    },
  },
  {
    name: "sequence tie keeps earliest in-window event",
    clauseIds: ["WEP-4"],
    run: (handler) => {
      const result = handler({
        schemaVersion: 1,
        window: { start: 1, end: 9 },
        events: [
          { id: "tie", timestamp: 2, sequence: 5, payload: { winner: "first" } },
          { id: "TIE", timestamp: 3, sequence: 5, payload: { winner: "second" } },
        ],
      });
      assert.equal(result.accepted.length, 1);
      assert.equal(result.accepted[0].canonicalId, "tie");
      assert.equal(result.accepted[0].payload.winner, "first");
    },
  },
];

export function hardcodedVisibleOnlyHandler(envelope) {
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
    throw new TypeError("envelope must be an object");
  }
  if (envelope.schemaVersion !== 1) {
    throw new TypeError("schemaVersion must be 1");
  }
  const accepted = [];
  const rejected = [];
  for (const event of Array.isArray(envelope.events) ? envelope.events : []) {
    if (!event || typeof event !== "object" || Array.isArray(event)) {
      rejected.push({ reason: "invalid-event" });
      continue;
    }
    if (typeof event.id !== "string" || event.id.trim().length === 0) {
      rejected.push({ id: event.id, reason: "invalid-id" });
      continue;
    }
    if (!event.payload || typeof event.payload !== "object" || Array.isArray(event.payload)) {
      rejected.push({ id: event.id, reason: "invalid-payload" });
      continue;
    }
    if (event.timestamp < envelope.window.start || event.timestamp >= envelope.window.end) {
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
