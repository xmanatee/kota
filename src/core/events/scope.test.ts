import { afterEach, expect, it, vi } from "vitest";
import { EventBus } from "./event-bus.js";
import { defineDaemonWideModuleEvent, initModuleEventRegistry, resetModuleEventRegistry } from "./module-event.js";
import { defineScopedModuleEvent, ScopedEventBus } from "./scope.js";

afterEach(resetModuleEventRegistry);
const event = defineScopedModuleEvent<{ value: string }>("example.scoped", ["value"]);

it("delivers only each subscriber's scope while raw subscribers see both", () => {
  const bus = new EventBus();
  const views = [new ScopedEventBus(bus, "a"), new ScopedEventBus(bus, "b")];
  const scoped = views.map((view) => { const receive = vi.fn(); view.on(event, receive); return receive; });
  const raw = vi.fn();
  bus.on(event, raw);
  views[0]!.emit(event, { value: "first" });
  views[1]!.emit(event, { value: "second" });
  const first = { scopeId: "a", value: "first" };
  const second = { scopeId: "b", value: "second" };
  expect(scoped[0]!.mock.calls).toEqual([[first]]);
  expect(scoped[1]!.mock.calls).toEqual([[second]]);
  expect(raw.mock.calls).toEqual([[first], [second]]);
});

it("filters wildcard scope traffic, broadcasts daemon events and releases subscriptions", () => {
  const bus = new EventBus();
  const view = new ScopedEventBus(bus, "a");
  const receive = vi.fn();
  const unsubscribe = view.onAny(receive);
  const daemon = defineDaemonWideModuleEvent<{ value: string }>("example.daemon", ["value"]);
  initModuleEventRegistry().register("example", daemon);
  view.emitDynamic(daemon.name, { value: "global" });
  view.emitDynamic(event.name, { value: "local" });
  new ScopedEventBus(bus, "b").emit(event, { value: "other" });
  expect(receive.mock.calls.map(([envelope]) => envelope.payload)).toEqual([
    { value: "global" }, { scopeId: "a", value: "local" },
  ]);
  unsubscribe();
  view.emit(event, { value: "after disposal" });
  expect(receive).toHaveBeenCalledTimes(2);
});

it.each(["typed", "dynamic", "outbox"])("rejects cross-scope %s emission without delivery", (route) => {
  const bus = new EventBus();
  const view = new ScopedEventBus(bus, "a");
  const receive = vi.fn();
  bus.on("*", receive);
  const payload = { scopeId: "b", value: "spoofed" };
  expect(() => {
    if (route === "typed") view.emit(event, payload);
    else if (route === "dynamic") view.emitDynamic(event.name, payload);
    else view.deliverOutbox(event.name, payload, "run:step:event");
  }).toThrow(/does not match scoped bus/);
  expect(receive).not.toHaveBeenCalled();
});
