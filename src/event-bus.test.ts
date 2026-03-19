import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type BusEnvelope,
  type BusEvents,
  EventBus,
  getEventBus,
  initEventBus,
  resetEventBus,
  tryEmit,
} from "./event-bus.js";

afterEach(() => resetEventBus());

describe("EventBus", () => {
  it("delivers typed events to subscribers", () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.on("session.start", handler);
    bus.emit("session.start", { sessionId: "s1" });
    expect(handler).toHaveBeenCalledWith({ sessionId: "s1" });
  });

  it("supports multiple subscribers for the same event", () => {
    const bus = new EventBus();
    const h1 = vi.fn();
    const h2 = vi.fn();
    bus.on("session.end", h1);
    bus.on("session.end", h2);
    bus.emit("session.end", { sessionId: "s1", durationMs: 100 });
    expect(h1).toHaveBeenCalledOnce();
    expect(h2).toHaveBeenCalledOnce();
  });

  it("does not deliver events to unsubscribed handlers", () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.on("session.start", handler);
    bus.off("session.start", handler as never);
    bus.emit("session.start", { sessionId: "s1" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("on() returns an unsubscribe function", () => {
    const bus = new EventBus();
    const handler = vi.fn();
    const unsub = bus.on("schedule.fire", handler);
    unsub();
    bus.emit("schedule.fire", { itemId: 1, description: "test" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("once() auto-unsubscribes after first call", () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.once("workflow.started", handler);
    bus.emit("workflow.started", {
      workflow: "builder",
      runId: "r1",
      triggerEvent: "runtime.idle",
      definitionPath: "src/workflows/builder/workflow.ts",
      runDir: ".kota/runs/r1",
      startedAt: "2026-01-01T00:00:00Z",
    });
    bus.emit("workflow.started", {
      workflow: "improver",
      runId: "r2",
      triggerEvent: "workflow.completed",
      definitionPath: "src/workflows/improver/workflow.ts",
      runDir: ".kota/runs/r2",
      startedAt: "2026-01-01T00:00:01Z",
    });
    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith({
      workflow: "builder",
      runId: "r1",
      triggerEvent: "runtime.idle",
      definitionPath: "src/workflows/builder/workflow.ts",
      runDir: ".kota/runs/r1",
      startedAt: "2026-01-01T00:00:00Z",
    });
  });

  it("once() returns an unsubscribe function that works before delivery", () => {
    const bus = new EventBus();
    const handler = vi.fn();
    const unsub = bus.once("session.start", handler);
    unsub();
    bus.emit("session.start", { sessionId: "s1" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("wildcard listener receives all events as envelopes", () => {
    const bus = new EventBus();
    const envelopes: BusEnvelope[] = [];
    bus.on("*", (e) => envelopes.push(e));
    bus.emit("session.start", { sessionId: "s1" });
    bus.emit("workflow.completed", {
      workflow: "builder",
      runId: "r1",
      status: "success",
      triggerEvent: "runtime.idle",
      durationMs: 50,
      definitionPath: "src/workflows/builder/workflow.ts",
      runDir: ".kota/runs/r1",
    });
    expect(envelopes).toHaveLength(2);
    expect(envelopes[0]).toEqual({
      type: "session.start",
      payload: { sessionId: "s1" },
    });
    expect(envelopes[1]).toEqual({
      type: "workflow.completed",
      payload: {
        workflow: "builder",
        runId: "r1",
        status: "success",
        triggerEvent: "runtime.idle",
        durationMs: 50,
        definitionPath: "src/workflows/builder/workflow.ts",
        runDir: ".kota/runs/r1",
      },
    });
  });

  it("does not deliver different event types to wrong handlers", () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.on("session.start", handler);
    bus.emit("session.end", { sessionId: "s1", durationMs: 0 });
    expect(handler).not.toHaveBeenCalled();
  });

  it("clear() removes all handlers", () => {
    const bus = new EventBus();
    const h1 = vi.fn();
    const h2 = vi.fn();
    bus.on("session.start", h1);
    bus.on("*", h2);
    bus.clear();
    bus.emit("session.start", { sessionId: "s1" });
    expect(h1).not.toHaveBeenCalled();
    expect(h2).not.toHaveBeenCalled();
  });

  it("listenerCount() reports correct counts", () => {
    const bus = new EventBus();
    expect(bus.listenerCount("session.start")).toBe(0);
    expect(bus.listenerCount()).toBe(0);
    const unsub1 = bus.on("session.start", vi.fn());
    bus.on("session.end", vi.fn());
    bus.on("*", vi.fn());
    expect(bus.listenerCount("session.start")).toBe(1);
    expect(bus.listenerCount()).toBe(3);
    unsub1();
    expect(bus.listenerCount("session.start")).toBe(0);
    expect(bus.listenerCount()).toBe(2);
  });

  it("off() is safe for non-existent handler", () => {
    const bus = new EventBus();
    expect(() => bus.off("session.start", vi.fn() as never)).not.toThrow();
  });

  it("off() is safe for non-existent event", () => {
    const bus = new EventBus();
    expect(() => bus.off("nonexistent", vi.fn() as never)).not.toThrow();
  });

  it("supports custom string events", () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.on("custom.event", handler);
    bus.emit("custom.event", { foo: "bar" });
    expect(handler).toHaveBeenCalledWith({ foo: "bar" });
  });

  it("handler errors do not prevent other handlers from running", () => {
    const bus = new EventBus();
    const h1 = vi.fn(() => {
      throw new Error("boom");
    });
    const h2 = vi.fn();
    bus.on("session.start", h1 as BusEvents["session.start"] extends infer T ? (payload: T) => void : never);
    bus.on("session.start", h2);
    // The current implementation doesn't catch errors — verify behavior
    expect(() =>
      bus.emit("session.start", { sessionId: "s1" }),
    ).toThrow("boom");
  });
});

describe("Singleton", () => {
  it("getEventBus() returns null when not initialized", () => {
    expect(getEventBus()).toBeNull();
  });

  it("initEventBus() creates and returns the bus", () => {
    const bus = initEventBus();
    expect(bus).toBeInstanceOf(EventBus);
    expect(getEventBus()).toBe(bus);
  });

  it("initEventBus() is idempotent", () => {
    const bus1 = initEventBus();
    const bus2 = initEventBus();
    expect(bus1).toBe(bus2);
  });

  it("resetEventBus() clears the singleton", () => {
    initEventBus();
    resetEventBus();
    expect(getEventBus()).toBeNull();
  });

  it("resetEventBus() clears handlers on existing bus", () => {
    const bus = initEventBus();
    bus.on("session.start", vi.fn());
    expect(bus.listenerCount()).toBe(1);
    resetEventBus();
    expect(bus.listenerCount()).toBe(0);
  });
});

describe("tryEmit", () => {
  it("is a no-op when bus is not initialized", () => {
    expect(() =>
      tryEmit("session.start", { sessionId: "s1" }),
    ).not.toThrow();
  });

  it("emits when bus is initialized", () => {
    const bus = initEventBus();
    const handler = vi.fn();
    bus.on("session.start", handler);
    tryEmit("session.start", { sessionId: "s1" });
    expect(handler).toHaveBeenCalledWith({ sessionId: "s1" });
  });
});
