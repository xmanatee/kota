import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { defineDaemonWideModuleEvent, initModuleEventRegistry, resetModuleEventRegistry } from "#core/events/module-event.js";
import { createEventEnvelopeDeadLetter, DeadLetterQueueStore } from "./dead-letter-queue.js";

const roots: string[] = [];
afterEach(() => {
  resetModuleEventRegistry();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

it.each(["internal", "sensitive", "secret"] as const)("redacts unjournaled %s events using their declared sensitivity", (sensitivity) => {
  const event = defineDaemonWideModuleEvent<{ body: string; opaque: string }>("example.rejected", ["body", "opaque"], {
    sensitivity,
    payloadSchema: { type: "object", properties: {
      body: { type: "string" }, opaque: { type: "string", sensitivity: "secret" },
    } },
  });
  initModuleEventRegistry().register("example", event);
  const root = mkdtempSync(join(tmpdir(), "kota-event-failure-"));
  roots.push(root);
  const store = new DeadLetterQueueStore(root);
  const payload = { body: 42, opaque: "canary-value-73" };
  const item = createEventEnvelopeDeadLetter({
    store, scopeId: "a", eventName: event.name, schemaRef: { name: event.name, version: 1 }, payload,
    reason: "body must be string", errorClass: "validation",
  });
  expect(item.redactedProjection).toEqual(sensitivity === "internal"
    ? { body: 42, opaque: "[redacted]" }
    : { redacted: true, reason: "event-classification" });
  expect(item).toMatchObject({
    type: "event-envelope", status: "open", scopeId: "a", sourceEventIds: [],
    failure: { lastErrorClass: "validation", retryCount: 1 },
    redrive: { kind: "none", reason: "event redrive requires the event journal" },
  });
  expect(readFileSync(store.getPath(), "utf8")).not.toContain("canary-value-73");
  expect(new DeadLetterQueueStore(root).get(item.id)?.redactedProjection).toEqual(item.redactedProjection);
  expect(payload.opaque).toBe("canary-value-73");
});
