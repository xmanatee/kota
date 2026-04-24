import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type BusEvents,
  EventBus,
  getEventBus,
  initEventBus,
  resetEventBus,
  tryEmit,
} from "./event-bus.js";

afterEach(() => {
  resetEventBus();
});

describe("EventBus", () => {
  describe("on / off", () => {
    it("delivers events to subscribers", () => {
      const bus = new EventBus();
      const handler = vi.fn();
      bus.on("workflow.started", handler);

      const payload = {
        workflow: "test",
        runId: "r1",
        triggerEvent: "t",
        definitionPath: "d",
        runDir: "r",
        startedAt: "2026-01-01",
      };
      bus.emit("workflow.started", payload);

      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith(payload);
    });

    it("returns an unsubscribe function", () => {
      const bus = new EventBus();
      const handler = vi.fn();
      const unsub = bus.on("runtime.idle", handler);

      unsub();
      bus.emit("runtime.idle", { timestamp: "t", idleIntervalMs: 0 });

      expect(handler).not.toHaveBeenCalled();
    });

    it("off removes a handler", () => {
      const bus = new EventBus();
      const handler = vi.fn();
      bus.on("runtime.idle", handler);
      bus.off("runtime.idle", handler);

      bus.emit("runtime.idle", { timestamp: "t", idleIntervalMs: 0 });
      expect(handler).not.toHaveBeenCalled();
    });

    it("double-off is safe", () => {
      const bus = new EventBus();
      const handler = vi.fn();
      bus.on("runtime.idle", handler);

      bus.off("runtime.idle", handler);
      bus.off("runtime.idle", handler);

      expect(bus.listenerCount("runtime.idle")).toBe(0);
    });

    it("off on unknown event is safe", () => {
      const bus = new EventBus();
      const handler = vi.fn();
      expect(() => bus.off("runtime.idle", handler)).not.toThrow();
    });
  });

  describe("once", () => {
    it("fires handler once then auto-unsubscribes", () => {
      const bus = new EventBus();
      const handler = vi.fn();
      bus.once("runtime.idle", handler);

      const payload = { timestamp: "t", idleIntervalMs: 100 };
      bus.emit("runtime.idle", payload);
      bus.emit("runtime.idle", payload);

      expect(handler).toHaveBeenCalledOnce();
      expect(bus.listenerCount("runtime.idle")).toBe(0);
    });

    it("returns an unsubscribe function that prevents the handler from firing", () => {
      const bus = new EventBus();
      const handler = vi.fn();
      const unsub = bus.once("runtime.idle", handler);

      unsub();
      bus.emit("runtime.idle", { timestamp: "t", idleIntervalMs: 0 });

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe("wildcard", () => {
    it("wildcard listener receives every event as BusEnvelope", () => {
      const bus = new EventBus();
      const wildcard = vi.fn();
      bus.on("*", wildcard);

      const payload = { timestamp: "t", idleIntervalMs: 0 };
      bus.emit("runtime.idle", payload);

      expect(wildcard).toHaveBeenCalledOnce();
      expect(wildcard).toHaveBeenCalledWith({
        type: "runtime.idle",
        payload,
      });
    });

    it("wildcard does not double-fire for * events", () => {
      const bus = new EventBus();
      const wildcard = vi.fn();
      bus.on("*", wildcard);

      bus.emit("*" as never, {} as never);

      expect(wildcard).toHaveBeenCalledOnce();
    });

    it("specific and wildcard listeners both fire on emit", () => {
      const bus = new EventBus();
      const specific = vi.fn();
      const wildcard = vi.fn();
      bus.on("runtime.idle", specific);
      bus.on("*", wildcard);

      bus.emit("runtime.idle", { timestamp: "t", idleIntervalMs: 0 });

      expect(specific).toHaveBeenCalledOnce();
      expect(wildcard).toHaveBeenCalledOnce();
    });
  });

  describe("emit fan-out order", () => {
    it("calls specific handlers in subscription order, then wildcard", () => {
      const bus = new EventBus();
      const order: string[] = [];
      bus.on("runtime.idle", () => order.push("first"));
      bus.on("runtime.idle", () => order.push("second"));
      bus.on("*", () => order.push("wildcard"));

      bus.emit("runtime.idle", { timestamp: "t", idleIntervalMs: 0 });

      expect(order).toEqual(["first", "second", "wildcard"]);
    });
  });

  describe("listenerCount", () => {
    it("returns 0 for unknown event", () => {
      const bus = new EventBus();
      expect(bus.listenerCount("runtime.idle")).toBe(0);
    });

    it("tracks listeners per event", () => {
      const bus = new EventBus();
      bus.on("runtime.idle", vi.fn());
      bus.on("runtime.idle", vi.fn());
      bus.on("workflow.started", vi.fn());

      expect(bus.listenerCount("runtime.idle")).toBe(2);
      expect(bus.listenerCount("workflow.started")).toBe(1);
    });

    it("returns total when no event specified", () => {
      const bus = new EventBus();
      bus.on("runtime.idle", vi.fn());
      bus.on("workflow.started", vi.fn());
      bus.on("*", vi.fn());

      expect(bus.listenerCount()).toBe(3);
    });

    it("decrements after off", () => {
      const bus = new EventBus();
      const handler = vi.fn();
      bus.on("runtime.idle", handler);
      expect(bus.listenerCount("runtime.idle")).toBe(1);

      bus.off("runtime.idle", handler);
      expect(bus.listenerCount("runtime.idle")).toBe(0);
    });
  });

  describe("clear", () => {
    it("removes all handlers", () => {
      const bus = new EventBus();
      bus.on("runtime.idle", vi.fn());
      bus.on("workflow.started", vi.fn());
      bus.on("*", vi.fn());

      bus.clear();
      expect(bus.listenerCount()).toBe(0);
    });
  });

  describe("custom events", () => {
    it("supports custom string event names outside the BusEvents map", () => {
      const bus = new EventBus();
      const handler = vi.fn();
      bus.on("custom.event", handler);
      bus.emit("custom.event", { foo: "bar" });
      expect(handler).toHaveBeenCalledWith({ foo: "bar" });
    });
  });

  describe("handler errors", () => {
    it("propagates synchronous handler errors out of emit", () => {
      const bus = new EventBus();
      const h1 = vi.fn(() => {
        throw new Error("boom");
      });
      const h2 = vi.fn();
      bus.on(
        "runtime.idle",
        h1 as BusEvents["runtime.idle"] extends infer T
          ? (payload: T) => void
          : never,
      );
      bus.on("runtime.idle", h2);
      expect(() =>
        bus.emit("runtime.idle", { timestamp: "t", idleIntervalMs: 0 }),
      ).toThrow("boom");
    });
  });
});

describe("singleton lifecycle", () => {
  it("initEventBus creates a singleton", () => {
    const bus = initEventBus();
    expect(bus).toBeInstanceOf(EventBus);
    expect(initEventBus()).toBe(bus);
  });

  it("getEventBus returns null before init", () => {
    expect(getEventBus()).toBeNull();
  });

  it("getEventBus returns the singleton after init", () => {
    const bus = initEventBus();
    expect(getEventBus()).toBe(bus);
  });

  it("resetEventBus clears handlers and nulls the singleton", () => {
    const bus = initEventBus();
    bus.on("runtime.idle", vi.fn());
    expect(bus.listenerCount()).toBe(1);

    resetEventBus();
    expect(bus.listenerCount()).toBe(0);
    expect(getEventBus()).toBeNull();
  });
});

describe("tryEmit", () => {
  it("is a no-op when bus is not initialized", () => {
    expect(() =>
      tryEmit("runtime.idle", { timestamp: "t", idleIntervalMs: 0 }),
    ).not.toThrow();
  });

  it("emits when bus is initialized", () => {
    const bus = initEventBus();
    const handler = vi.fn();
    bus.on("runtime.idle", handler);

    tryEmit("runtime.idle", { timestamp: "t", idleIntervalMs: 0 });
    expect(handler).toHaveBeenCalledOnce();
  });
});
