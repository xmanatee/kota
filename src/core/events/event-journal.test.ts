import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { type BusEnvelope, EventBus } from "./event-bus.js";
import { EventJournal, installEventJournal } from "./event-journal.js";
import { initModuleEventRegistry, resetModuleEventRegistry } from "./module-event.js";
import { defineScopedModuleEvent } from "./scope.js";

const roots: string[] = [];
function directory() {
  const root = mkdtempSync(join(tmpdir(), "kota-journal-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  resetModuleEventRegistry();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

// A semantic channel example, independent of any product module's event catalog.
const message = defineScopedModuleEvent<{ body: string; opaque: string }>("example.received", ["body", "opaque"], {
  schemaVersion: 2,
  payloadSchema: {
    type: "object",
    properties: { body: { type: "string" }, opaque: { type: "string", sensitivity: "secret" } },
    additionalProperties: true,
  },
});
const payload = {
  scopeId: "a", body: "Book the court.", opaque: "canary-value-73",
  provider: "example", channel: "chat", accountId: "account", sourceId: "room", externalId: "message",
  occurredAt: "2026-06-05T10:00:00.000Z", receivedAt: "2026-06-05T10:00:01.000Z",
  correlationId: "conversation", causationId: "request", parentEventId: "parent",
  idempotencyKey: "example:message",
  traceContext: { traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01", tracestate: "example=chat" },
};

it("persists redacted channel provenance and replays the same identity after restart", () => {
  initModuleEventRegistry().register("example", message);
  const root = directory();
  const journal = new EventJournal(root, { scopeLineage: (id) => ["global", id] });
  const bus = new EventBus();
  const delivered: BusEnvelope[] = [];
  bus.on("*", (envelope) => delivered.push(envelope));
  const uninstall = installEventJournal(bus, journal);
  bus.emit(message.name, payload);
  uninstall();
  bus.emit(message.name, { ...payload, body: "not journaled" });
  expect(journal.query()).toHaveLength(1);
  const [event] = journal.query({ type: message.name, scopeId: "a", sourceId: "example:chat:account:room:message" });
  expect(event).toMatchObject({
    id: delivered[0]!.eventId, sequence: 1,
    event: { name: message.name, schema: { version: 2 } },
    scope: { kind: "scope", scopeId: "a", lineage: ["global", "a"] },
    source: { kind: "channel", id: "example:chat:account:room:message" },
    producer: { kind: "channel", provider: "example", channel: "chat", sourceId: "room", externalId: "message" },
    causality: { correlationId: "conversation", causationId: "request", parentEventId: "parent" },
    trace: payload.traceContext,
    idempotency: { idempotencyKey: "example:message", externalProviderId: "message" },
  });
  const redacted = { ...payload, opaque: "[redacted]" };
  expect(journal.toClientProjection(event!).payload).toEqual(redacted);
  expect(readFileSync(journal.getPath(), "utf8")).not.toContain("canary-value-73");
  expect(payload.opaque).toBe("canary-value-73");
  const restarted = new EventJournal(root);
  const replayed: BusEnvelope[] = [];
  restarted.replay({ id: event!.id }, (envelope) => replayed.push(envelope));
  expect(replayed).toEqual([{
    type: message.name, eventId: event!.id, schemaRef: { name: message.name, version: 2 }, payload: redacted,
  }]);
  const next = restarted.appendFromBusEnvelope({ type: "runtime.example", schemaRef: null, payload: {} });
  expect(next.sequence).toBe(2);
  expect(restarted.query({ after: event!.id }).map(({ id }) => id)).toEqual([next.id]);
  for (const query of [{ scopeId: "b" }, { sourceId: "other" }, { type: "other" }, { after: "missing" }]) {
    expect(restarted.query(query)).toEqual([]);
  }
});

it("assigns distinct identities to ordinary live events", () => {
  const journal = new EventJournal(directory());
  const bus = new EventBus();
  const delivered: BusEnvelope[] = [];
  bus.on("*", (envelope) => delivered.push(envelope));
  installEventJournal(bus, journal);
  bus.emit("example.repeated", { value: 1 });
  bus.emit("example.repeated", { value: 1 });
  expect(delivered.map(({ eventId }) => eventId)).toEqual(["evtj-000000000001", "evtj-000000000002"]);
  expect(journal.query().map(({ id }) => id)).toEqual(delivered.map(({ eventId }) => eventId));
});

it("deduplicates outbox storage across restart and rejects changed content before delivery", () => {
  const root = directory();
  const eventId = "workflow:run:step:event";
  const delivered: BusEnvelope[] = [];
  const failures: string[] = [];
  for (let restart = 0; restart < 2; restart++) {
    const bus = new EventBus();
    const journal = new EventJournal(root);
    bus.on("*", (envelope) => delivered.push(envelope));
    bus.addEmitFailureHandler(({ error }) => failures.push(error.message));
    installEventJournal(bus, journal);
    bus.deliverOutbox("example.outbox", { value: 1 }, eventId);
    const original = readFileSync(journal.getPath(), "utf8");
    bus.deliverOutbox("example.outbox", { value: 1 }, eventId);
    bus.deliverOutbox("example.outbox", { value: 2 }, eventId);
    expect(readFileSync(journal.getPath(), "utf8")).toBe(original);
    expect(journal.query()).toMatchObject([{ idempotency: { eventId }, payload: { kind: "inline", payload: { value: 1 } } }]);
  }
  expect(delivered.map(({ eventId: id }) => id)).toEqual([eventId, eventId, eventId, eventId]);
  expect(failures).toEqual(Array(2).fill(expect.stringMatching(/redelivered with different content/)));
});

it("recovers the cursor from a journal larger than an argument-spread stack", () => {
  const root = directory();
  const source = new EventJournal(root).appendFromBusEnvelope({ type: "example.bulk", schemaRef: null, payload: {} });
  const file = join(root, "journal.jsonl");
  writeFileSync(file, `${Array.from({ length: 120_000 }, (_, i) => JSON.stringify({
    ...source, id: `bulk-${i + 1}`, sequence: i + 1,
  })).join("\n")}\n`);
  const journal = new EventJournal(root);
  const next = journal.appendFromBusEnvelope({ type: "example.next", schemaRef: null, payload: {} });
  expect(next.sequence).toBe(120_001);
  expect(journal.query({ limit: 1 })).toEqual([next]);
}, 20_000);

it.each(["limit", "time"])("bounds %s queries before unrelated malformed history", (mode) => {
  let now = new Date("2026-06-05T10:00:00.000Z");
  const journal = new EventJournal(directory(), { now: () => now });
  writeFileSync(journal.getPath(), "malformed history\n");
  journal.appendFromBusEnvelope({ type: "example.old", schemaRef: null, payload: {} });
  const boundary = now.getTime();
  now = new Date(boundary + 1000);
  const recent = journal.appendFromBusEnvelope({ type: "example.recent", schemaRef: null, payload: {} });
  expect(journal.query(mode === "limit" ? { limit: 1 } : { sinceMs: boundary })).toEqual([recent]);
  expect(() => journal.query()).toThrow(/malformed event journal entry/);
});

it.each(["metadata-reference", "exclude-from-query"] as const)("expires payloads under %s retention", (expiredBehavior) => {
  let now = new Date("2026-06-05T10:00:00.000Z");
  const journal = new EventJournal(directory(), {
    now: () => now, retention: { kind: "expire-after-ms", durationMs: 10 },
  });
  const source = journal.appendFromBusEnvelope({ type: "workflow.completed", schemaRef: null, payload: {
    scopeId: "a", workflow: "builder", runId: "run", rawPayload: { prompt: "do not retain" },
  } });
  const retained = new EventJournal(directory(), { now: () => now });
  if (source.retention.kind !== "expires") throw new Error("Expected expiring fixture");
  retained.appendEnvelope({ ...source, retention: { ...source.retention, expiredBehavior } });
  expect(retained.query()).toHaveLength(1);
  expect(retained.queryPrunedReferences()).toEqual([]);
  now = new Date(now.getTime() + 11);
  expect(retained.query({ id: source.id })).toEqual([]);
  const references = retained.queryPrunedReferences({ id: source.id });
  if (expiredBehavior === "exclude-from-query") expect(references).toEqual([]);
  else expect(references).toMatchObject([{
    artifactType: "event-envelope", id: source.id, payloadExpired: true,
    retained: { event: "workflow.completed", scopeId: "a" },
    provenance: { workflowName: "builder", runId: "run" },
  }]);
  expect(JSON.stringify(references)).not.toContain("do not retain");
});

it("rejects schema failures before journal append and subscriber delivery", () => {
  initModuleEventRegistry().register("example", message);
  const journal = new EventJournal(directory());
  const bus = new EventBus();
  const delivered: BusEnvelope[] = [];
  const failures: string[] = [];
  installEventJournal(bus, journal);
  bus.on("*", (envelope) => delivered.push(envelope));
  bus.addEmitFailureHandler((failure) => {
    failures.push(failure.stage);
  });
  expect(() => bus.emit(message.name, { ...payload, body: 42 })).toThrow(/payload failed schema/);
  expect(delivered).toEqual([]);
  expect(journal.query()).toEqual([]);
  expect(failures).toEqual(["validation"]);
});

it("redacts unregistered secret keys recursively without hiding safe content", () => {
  const journal = new EventJournal(directory());
  const event = journal.appendFromBusEnvelope({ type: "example.unregistered", schemaRef: null, payload: {
    token: "raw-token", nested: { password: "raw-password", safe: "visible" }, values: [{ apiKey: "raw-key", label: "kept" }],
  } });
  expect(journal.toClientProjection(event).payload).toEqual({
    token: "[redacted]", nested: { password: "[redacted]", safe: "visible" }, values: [{ apiKey: "[redacted]", label: "kept" }],
  });
  expect(readFileSync(journal.getPath(), "utf8")).not.toMatch(/raw-token|raw-password|raw-key/);
});
