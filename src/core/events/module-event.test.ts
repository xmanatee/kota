/**
 * Module-event declaration / registry tests.
 *
 * Covers the declaration helper, registry collision detection, registry
 * lifecycle (register/unregister), and integration with `EventBus.emit`
 * via the typed-overload path.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initEventBus, resetEventBus } from "./event-bus.js";
import {
  defineModuleEvent,
  getModuleEventRegistry,
  initModuleEventRegistry,
  resetModuleEventRegistry,
} from "./module-event.js";

beforeEach(() => {
  resetEventBus();
  resetModuleEventRegistry();
});

afterEach(() => {
  resetEventBus();
  resetModuleEventRegistry();
});

describe("defineModuleEvent", () => {
  it("captures the event name and field list", () => {
    const decl = defineModuleEvent<{ id: string; count: number }>(
      "test.event",
      ["id", "count"],
    );
    expect(decl.name).toBe("test.event");
    expect(decl.fields).toEqual(["id", "count"]);
  });
});

describe("ModuleEventRegistry", () => {
  it("registers and looks up declarations", () => {
    const moduleEvents = initModuleEventRegistry();
    const decl = defineModuleEvent<{ id: string }>("alpha.event", ["id"]);
    moduleEvents.register("alpha", decl);

    expect(moduleEvents.get("alpha.event")).toEqual({
      module: "alpha",
      fields: ["id"],
    });
    expect(moduleEvents.has("alpha.event")).toBe(true);
  });

  it("rejects collision across modules", () => {
    const moduleEvents = initModuleEventRegistry();
    moduleEvents.register("alpha", defineModuleEvent("shared.event", ["x"]));
    expect(() =>
      moduleEvents.register("beta", defineModuleEvent("shared.event", ["y"])),
    ).toThrow(/already declared/);
  });

  it("re-registering by the same module is idempotent", () => {
    const moduleEvents = initModuleEventRegistry();
    const a = defineModuleEvent("alpha.event", ["x"]);
    moduleEvents.register("alpha", a);
    moduleEvents.register("alpha", a);
    expect(moduleEvents.get("alpha.event")?.module).toBe("alpha");
  });

  it("unregisterModule clears only that module's events", () => {
    const moduleEvents = initModuleEventRegistry();
    moduleEvents.register("alpha", defineModuleEvent("alpha.event", ["x"]));
    moduleEvents.register("beta", defineModuleEvent("beta.event", ["y"]));
    moduleEvents.unregisterModule("alpha");
    expect(moduleEvents.has("alpha.event")).toBe(false);
    expect(moduleEvents.has("beta.event")).toBe(true);
  });

  it("getModuleEventRegistry returns null before init", () => {
    expect(getModuleEventRegistry()).toBeNull();
  });
});

describe("EventBus.emit with ModuleEventDef overload", () => {
  it("routes typed module events to subscribers", () => {
    const bus = initEventBus();
    const decl = defineModuleEvent<{ value: number }>("ord.event", ["value"]);
    const received: number[] = [];
    bus.on(decl, (payload) => received.push(payload.value));
    bus.emit(decl, { value: 7 });
    expect(received).toEqual([7]);
  });
});
