/**
 * Integration tests verifying webhook → event bus → scheduler pipeline.
 *
 * The key integration: POST /api/events/:name fires an event on the bus,
 * which triggers event-based scheduler items, which can then execute actions.
 * This is the pipeline that enables external systems (GitHub webhooks, CI)
 * to trigger KOTA automations.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type EventBus, initEventBus, resetEventBus } from "./event-bus.js";
import { getScheduler, initScheduler, resetScheduler, type Scheduler } from "./scheduler/scheduler.js";

describe("webhook → event bus → scheduler integration", () => {
  let bus: EventBus;
  let scheduler: Scheduler;
  let firedItems: Array<import("./scheduler/scheduler.js").ScheduledItem[]>;

  beforeEach(() => {
    resetEventBus();
    resetScheduler();
    bus = initEventBus();
    initScheduler(undefined, null); // in-memory mode
    scheduler = getScheduler();
    firedItems = [];
    scheduler.connectBus(bus, (items) => {
      firedItems.push(items);
    });
  });

  afterEach(() => {
    resetScheduler();
    resetEventBus();
  });

 it("event trigger fires when matching event is emitted", () => {
    scheduler.addEventTrigger("Run tests on deploy", "deploy.complete");

    bus.emit("deploy.complete", { repo: "my-app" });

    expect(firedItems).toHaveLength(1);
    expect(firedItems[0]).toHaveLength(1);
    expect(firedItems[0][0].description).toBe("Run tests on deploy");
  });

  it("event trigger with filter only fires when payload matches", () => {
    scheduler.addEventTrigger("Deploy staging", "deploy.complete", {
      filter: { env: "staging" },
    });

    // Non-matching payload
    bus.emit("deploy.complete", { env: "production" });
    expect(firedItems).toHaveLength(0);

    // Matching payload
    bus.emit("deploy.complete", { env: "staging" });
    expect(firedItems).toHaveLength(1);
    expect(firedItems[0][0].description).toBe("Deploy staging");
  });

  it("repeat event trigger re-arms after firing", () => {
    scheduler.addEventTrigger("Log every session end", "session.end", {
      repeat: true,
    });

    bus.emit("session.end", { sessionId: "a", durationMs: 100 });
    bus.emit("session.end", { sessionId: "b", durationMs: 200 });

    expect(firedItems).toHaveLength(2);
  });

  it("non-repeat event trigger fires only once", () => {
    scheduler.addEventTrigger("One-shot cleanup", "session.end", {
      repeat: false,
    });

    bus.emit("session.end", { sessionId: "a", durationMs: 100 });
    bus.emit("session.end", { sessionId: "b", durationMs: 200 });

    expect(firedItems).toHaveLength(1);
  });

  it("multiple triggers can fire from the same event", () => {
    scheduler.addEventTrigger("Action A", "build.done");
    scheduler.addEventTrigger("Action B", "build.done");

    bus.emit("build.done", {});

    expect(firedItems).toHaveLength(1);
    expect(firedItems[0]).toHaveLength(2);
    const descriptions = firedItems[0].map((i) => i.description).sort();
    expect(descriptions).toEqual(["Action A", "Action B"]);
  });

  it("unrelated events do not trigger items", () => {
    scheduler.addEventTrigger("On deploy", "deploy.complete");

    bus.emit("session.end", { sessionId: "x", durationMs: 50 });

    expect(firedItems).toHaveLength(0);
  });

  it("cancelled event triggers do not fire", () => {
    const item = scheduler.addEventTrigger("Should not fire", "test.event");
    scheduler.cancel(item.id);

    bus.emit("test.event", {});

    expect(firedItems).toHaveLength(0);
  });
});
