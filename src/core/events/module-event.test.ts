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
  defineDaemonWideModuleEvent,
  defineModuleEvent,
  getModuleEventRegistry,
  initModuleEventRegistry,
  resetModuleEventRegistry,
} from "./module-event.js";
import { defineProjectScopedModuleEvent } from "./project-scope.js";

beforeEach(() => {
  resetEventBus();
  resetModuleEventRegistry();
});

afterEach(() => {
  resetEventBus();
  resetModuleEventRegistry();
});

describe("defineModuleEvent", () => {
  it("captures the event name, field list, and explicit scope", () => {
    const decl = defineModuleEvent<{ id: string; count: number }>(
      "test.event",
      ["id", "count"],
      "daemon",
    );
    expect(decl.name).toBe("test.event");
    expect(decl.fields).toEqual(["id", "count"]);
    expect(decl.scope).toBe("daemon");
  });

  it("defineDaemonWideModuleEvent sugar yields scope: 'daemon'", () => {
    const decl = defineDaemonWideModuleEvent<{ id: string }>("daemon.sugar", [
      "id",
    ]);
    expect(decl.scope).toBe("daemon");
    expect(decl.fields).toEqual(["id"]);
  });

  it("defineProjectScopedModuleEvent yields scope: 'project' and prepends projectId", () => {
    const decl = defineProjectScopedModuleEvent<{ id: string }>(
      "project.sugar",
      ["id"],
    );
    expect(decl.scope).toBe("project");
    expect(decl.fields).toEqual(["projectId", "id"]);
  });
});

describe("ModuleEventRegistry", () => {
  it("registers and looks up declarations", () => {
    const moduleEvents = initModuleEventRegistry();
    const decl = defineDaemonWideModuleEvent<{ id: string }>("alpha.event", [
      "id",
    ]);
    moduleEvents.register("alpha", decl);

    expect(moduleEvents.get("alpha.event")).toEqual({
      module: "alpha",
      fields: ["id"],
    });
    expect(moduleEvents.has("alpha.event")).toBe(true);
  });

  it("rejects collision across modules", () => {
    const moduleEvents = initModuleEventRegistry();
    moduleEvents.register(
      "alpha",
      defineDaemonWideModuleEvent("shared.event", ["x"]),
    );
    expect(() =>
      moduleEvents.register(
        "beta",
        defineDaemonWideModuleEvent("shared.event", ["y"]),
      ),
    ).toThrow(/already declared/);
  });

  it("re-registering by the same module is idempotent", () => {
    const moduleEvents = initModuleEventRegistry();
    const a = defineDaemonWideModuleEvent("alpha.event", ["x"]);
    moduleEvents.register("alpha", a);
    moduleEvents.register("alpha", a);
    expect(moduleEvents.get("alpha.event")?.module).toBe("alpha");
  });

  it("unregisterModule clears only that module's events", () => {
    const moduleEvents = initModuleEventRegistry();
    moduleEvents.register(
      "alpha",
      defineDaemonWideModuleEvent("alpha.event", ["x"]),
    );
    moduleEvents.register(
      "beta",
      defineDaemonWideModuleEvent("beta.event", ["y"]),
    );
    moduleEvents.unregisterModule("alpha");
    expect(moduleEvents.has("alpha.event")).toBe(false);
    expect(moduleEvents.has("beta.event")).toBe(true);
  });

  it("getModuleEventRegistry returns null before init", () => {
    expect(getModuleEventRegistry()).toBeNull();
  });
});

describe("EventBus.emit with ModuleEventDef overload", () => {
  it("routes typed daemon-wide module events to subscribers", () => {
    const bus = initEventBus();
    const decl = defineDaemonWideModuleEvent<{ value: number }>("ord.event", [
      "value",
    ]);
    const received: number[] = [];
    bus.on(decl, (payload) => received.push(payload.value));
    bus.emit(decl, { value: 7 });
    expect(received).toEqual([7]);
  });

  it("rejects emit of a project-scoped module event without projectId", () => {
    const bus = initEventBus();
    const decl = defineProjectScopedModuleEvent<{ value: number }>(
      "scoped.event",
      ["value"],
    );
    // Cast bypasses the typed overload to exercise the runtime guard against a
    // payload that genuinely omits projectId.
    expect(() =>
      bus.emit(decl, { value: 1 } as unknown as never),
    ).toThrow(/project-scoped/);
  });

  it("accepts emit of a project-scoped module event when projectId is present", () => {
    const bus = initEventBus();
    const decl = defineProjectScopedModuleEvent<{ value: number }>(
      "scoped.ok",
      ["value"],
    );
    const received: { projectId: string; value: number }[] = [];
    bus.on(decl, (payload) => received.push(payload));
    bus.emit(decl, { projectId: "p1", value: 5 });
    expect(received).toEqual([{ projectId: "p1", value: 5 }]);
  });
});
