import assert from "node:assert/strict";
import { processProtocolBatch } from "../src/protocol-handler.mjs";

assert.throws(
  () => processProtocolBatch(null),
  /envelope must be an object/,
  "rejects missing envelope",
);

assert.throws(
  () => processProtocolBatch({ schemaVersion: 1, window: { start: 10, end: 10 }, events: [] }),
  /window.start/,
  "rejects empty windows",
);

const generic = processProtocolBatch({
  schemaVersion: 1,
  window: { start: 10, end: 20 },
  events: [
    { id: "visible-1", timestamp: 12, payload: { ok: true } },
    { id: "bad-payload", timestamp: 13, payload: null },
    { id: "before-window", timestamp: 9, payload: { ok: true } },
  ],
});

assert.equal(generic.accepted.length, 1, "accepts one valid visible event");
assert.equal(generic.accepted[0].id, "visible-1");
assert.deepEqual(
  generic.rejected.map((entry) => entry.reason).sort(),
  ["invalid-payload", "outside-window"],
  "rejects generic invalid event shapes",
);

console.log(JSON.stringify({ status: "passed", genericCases: 3 }, null, 2));
