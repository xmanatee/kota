import { afterEach, expect, it, vi } from "vitest";
import { EventBus } from "./event-bus.js";
import { defineDaemonWideModuleEvent, initModuleEventRegistry, resetModuleEventRegistry } from "./module-event.js";
import { defineScopedModuleEvent } from "./scope.js";

afterEach(resetModuleEventRegistry);
const event = defineDaemonWideModuleEvent<{ value: number }>("example.changed", ["value"], {
  schemaVersion: 4,
  payloadSchema: { type: "object", properties: { value: { type: "number" } } },
});

it("preserves a single declaration owner and schema across registration", () => {
  const registry = initModuleEventRegistry();
  registry.register("example", event);
  registry.register("example", event);
  expect(() => registry.register("other", event)).toThrow(/already declared/);
  const incompatible = defineDaemonWideModuleEvent<{ value: string }>(event.name, ["value"], {
    payloadSchema: { type: "object", properties: { value: { type: "string" } } },
  });
  expect(() => registry.register("example", incompatible)).toThrow(/incompatible schema/);
  const bus = new EventBus();
  const receive = vi.fn();
  bus.on("*", receive);
  bus.emit(event.name, { value: 7 });
  expect(receive).toHaveBeenCalledExactlyOnceWith({
    type: event.name, schemaRef: { name: event.name, version: 4 }, payload: { value: 7 },
  });
  expect(() => bus.emit(event.name, { value: "bad" })).toThrow(/payload.value must be number/);
});

it.each(["typed", "registered string"])("rejects malformed %s payloads before middleware and fan-out", (route) => {
  const bus = new EventBus();
  const receive = vi.fn();
  const middleware = vi.fn((_envelope, next: () => void) => next());
  bus.on(event, receive);
  bus.addEmitMiddleware(middleware);
  initModuleEventRegistry().register("example", event);
  const selected = route === "typed" ? event : event.name;
  expect(() => {
    if (typeof selected === "string") bus.emit(selected, { value: "bad" });
    else bus.emit(selected, { value: "bad" } as never);
  }).toThrow(/payload.value must be number/);
  expect(receive).not.toHaveBeenCalled();
  expect(middleware).not.toHaveBeenCalled();
  if (typeof selected === "string") bus.emit(selected, { value: 9 });
  else bus.emit(selected, { value: 9 });
  expect(receive.mock.calls).toEqual([[{ value: 9 }]]);
});

it.each([undefined, "", 42])("rejects invalid scope identity %s before delivery", (scopeId) => {
  const scoped = defineScopedModuleEvent<{ value: number }>("example.scoped", ["value"]);
  const bus = new EventBus();
  const receive = vi.fn();
  bus.on(scoped, receive);
  expect(() => bus.emit(scoped, { scopeId, value: 1 } as never)).toThrow(/scope-scoped/);
  bus.emit(scoped, { scopeId: "a", value: 1 });
  expect(receive.mock.calls).toEqual([[{ scopeId: "a", value: 1 }]]);
});
