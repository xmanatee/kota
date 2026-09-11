import { afterEach, expect, it, vi } from "vitest";
import { EventBus, getEventBus, initEventBus, resetEventBus, tryEmit } from "./event-bus.js";

afterEach(resetEventBus);
const idle = { scopeId: "a", timestamp: "now", idleIntervalMs: 100 };

it("delivers payloads and wildcard envelopes in subscription order", () => {
  const bus = new EventBus();
  const received: unknown[] = [];
  bus.on("runtime.idle", (payload) => received.push(["first", payload]));
  bus.on("runtime.idle", (payload) => received.push(["second", payload]));
  bus.on("*", (envelope) => received.push(envelope));
  bus.emit("runtime.idle", idle);
  expect(received).toEqual([
    ["first", idle], ["second", idle],
    { type: "runtime.idle", schemaRef: null, payload: idle },
  ]);
});

it.each(["off", "unsubscribe", "once", "clear"] as const)("releases subscriptions through %s", (mode) => {
  const bus = new EventBus();
  const handler = vi.fn();
  const cancel = mode === "once" ? bus.once("runtime.idle", handler) : bus.on("runtime.idle", handler);
  bus.emit("runtime.idle", idle);
  if (mode === "off") { bus.off("runtime.idle", handler); bus.off("runtime.idle", handler); }
  if (mode === "unsubscribe") { cancel(); cancel(); }
  if (mode === "clear") bus.clear();
  bus.emit("runtime.idle", idle);
  expect(handler.mock.calls).toEqual([[idle]]);
  expect(bus.listenerCount()).toBe(0);
});

it("cancels once before delivery and removes it before recursive emission", () => {
  const bus = new EventBus();
  const cancelled = vi.fn();
  bus.once("runtime.idle", cancelled)();
  const received: string[] = [];
  bus.once("runtime.idle", () => { received.push("once"); bus.emit("runtime.idle", idle); });
  bus.emit("runtime.idle", idle);
  expect(received).toEqual(["once"]);
  expect(cancelled).not.toHaveBeenCalled();
});

it("gates all delivery until middleware disposal and clears the gate on reset", () => {
  const bus = new EventBus();
  const received: string[] = [];
  bus.on("runtime.idle", () => received.push("specific"));
  bus.on("*", () => received.push("wildcard"));
  const release = bus.addEmitMiddleware(() => {});
  bus.addEmitMiddleware((_event, next) => { received.push("forwarded"); next(); });
  bus.emit("runtime.idle", idle);
  expect(received).toEqual([]);
  release(); release();
  bus.emit("runtime.idle", idle);
  expect(received).toEqual(["forwarded", "specific", "wildcard"]);
  bus.addEmitMiddleware(() => {});
  bus.clear();
  received.length = 0;
  bus.on("runtime.idle", () => received.push("fresh"));
  bus.emit("runtime.idle", idle);
  expect(received).toEqual(["fresh"]);
});

it("starts a fresh middleware chain for a released event", () => {
  const bus = new EventBus();
  const received: string[] = [];
  bus.on("runtime.idle", ({ timestamp }) => received.push(timestamp));
  bus.addEmitMiddleware((envelope, next) => {
    if (envelope.payload.timestamp === "released") next();
    else bus.emit("runtime.idle", { ...idle, timestamp: "released" });
  });
  bus.emit("runtime.idle", idle);
  expect(received).toEqual(["released"]);
});

it("finishes fan-out before reporting the first subscriber failure", () => {
  const bus = new EventBus();
  const received: string[] = [];
  const failures = vi.fn();
  bus.addEmitFailureHandler(failures);
  bus.on("runtime.idle", () => { throw new Error("first failure"); });
  bus.on("runtime.idle", () => received.push("healthy"));
  bus.on("*", () => { received.push("wildcard"); throw new Error("second failure"); });
  expect(() => bus.emit("runtime.idle", idle)).toThrow("first failure");
  expect(received).toEqual(["healthy", "wildcard"]);
  expect(failures).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    event: "runtime.idle", payload: idle, stage: "fanout", error: new Error("first failure"),
  }));
});

it("singleton teardown stops delivery and allows fresh initialization", () => {
  tryEmit("runtime.idle", idle);
  expect(getEventBus()).toBeNull();
  const bus = initEventBus();
  expect(initEventBus()).toBe(bus);
  const received = vi.fn();
  bus.on("runtime.idle", received);
  tryEmit("runtime.idle", idle);
  resetEventBus();
  bus.emit("runtime.idle", idle);
  tryEmit("runtime.idle", idle);
  initEventBus().on("runtime.idle", received);
  tryEmit("runtime.idle", idle);
  expect(received.mock.calls).toEqual([[idle], [idle]]);
});

it("contains failure-reporting reentry and preserves both errors for the caller", () => {
  const bus = new EventBus();
  const dispatchError = new Error("journal unavailable");
  bus.addEmitMiddleware(() => { throw dispatchError; });
  const report = vi.fn(() => bus.emit("failure.recorded", {}));
  const otherObserver = vi.fn();
  bus.addEmitFailureHandler(report);
  bus.addEmitFailureHandler(otherObserver);

  for (let attempt = 0; attempt < 2; attempt++) {
    let caught: unknown;
    try { bus.emit("work.requested", {}); } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(AggregateError);
    expect((caught as AggregateError).errors).toEqual([dispatchError, dispatchError]);
  }
  expect(report).toHaveBeenCalledTimes(2);
  expect(otherObserver).toHaveBeenCalledTimes(2);
});
