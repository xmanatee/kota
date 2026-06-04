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
    expect(decl.schema.currentVersion).toBe(1);
    expect(decl.filterablePaths).toEqual(["id", "count"]);
  });

  it("defineDaemonWideModuleEvent sugar yields scope: 'daemon'", () => {
    const decl = defineDaemonWideModuleEvent<{ id: string }>("daemon.sugar", [
      "id",
    ]);
    expect(decl.scope).toBe("daemon");
    expect(decl.fields).toEqual(["id"]);
  });

  it("defineProjectScopedModuleEvent yields scope: 'project' and prepends scope selectors", () => {
    const decl = defineProjectScopedModuleEvent<{ id: string }>(
      "project.sugar",
      ["id"],
    );
    expect(decl.scope).toBe("project");
    expect(decl.fields).toEqual(["scopeId", "projectId", "id"]);
  });
});

describe("ModuleEventRegistry", () => {
  it("registers and looks up declarations", () => {
    const moduleEvents = initModuleEventRegistry();
    const decl = defineDaemonWideModuleEvent<{ id: string }>("alpha.event", [
      "id",
    ]);
    moduleEvents.register("alpha", decl);

    expect(moduleEvents.get("alpha.event")).toMatchObject({
      module: "alpha",
      name: "alpha.event",
      scope: "daemon",
      fields: ["id"],
      currentVersion: 1,
      filterablePaths: ["id"],
    });
    expect(moduleEvents.has("alpha.event")).toBe(true);
  });

  it("rejects collision across modules", () => {
    const moduleEvents = initModuleEventRegistry();
    moduleEvents.register(
      "alpha",
      defineDaemonWideModuleEvent<{ x: string }>("shared.event", ["x"]),
    );
    expect(() =>
      moduleEvents.register(
        "beta",
        defineDaemonWideModuleEvent<{ y: string }>("shared.event", ["y"]),
      ),
    ).toThrow(/already declared/);
  });

  it("re-registering by the same module is idempotent", () => {
    const moduleEvents = initModuleEventRegistry();
    const a = defineDaemonWideModuleEvent<{ x: string }>("alpha.event", ["x"]);
    moduleEvents.register("alpha", a);
    moduleEvents.register("alpha", a);
    expect(moduleEvents.get("alpha.event")?.module).toBe("alpha");
  });

  it("rejects incompatible redeclaration by the same module", () => {
    const moduleEvents = initModuleEventRegistry();
    moduleEvents.register(
      "alpha",
      defineDaemonWideModuleEvent<{ x: string }>("alpha.event", ["x"], {
        payloadSchema: {
          type: "object",
          properties: { x: { type: "string" } },
        },
      }),
    );
    expect(() =>
      moduleEvents.register(
        "alpha",
        defineDaemonWideModuleEvent<{ x: number }>("alpha.event", ["x"], {
          payloadSchema: {
            type: "object",
            properties: { x: { type: "number" } },
          },
        }),
      ),
    ).toThrow(/incompatible schema/);
  });

  it("unregisterModule clears only that module's events", () => {
    const moduleEvents = initModuleEventRegistry();
    moduleEvents.register(
      "alpha",
      defineDaemonWideModuleEvent<{ x: string }>("alpha.event", ["x"]),
    );
    moduleEvents.register(
      "beta",
      defineDaemonWideModuleEvent<{ y: string }>("beta.event", ["y"]),
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
    const decl = defineDaemonWideModuleEvent<{ value: number }>(
      "ord.event",
      ["value"],
      {
        payloadSchema: {
          type: "object",
          properties: { value: { type: "number" } },
        },
      },
    );
    const received: number[] = [];
    bus.on(decl, (payload) => received.push(payload.value));
    bus.emit(decl, { value: 7 });
    expect(received).toEqual([7]);
  });

  it("rejects malformed typed module payloads before subscriber fan-out", () => {
    const bus = initEventBus();
    const decl = defineDaemonWideModuleEvent<{ value: number }>(
      "strict.event",
      ["value"],
      {
        payloadSchema: {
          type: "object",
          properties: { value: { type: "number" } },
        },
      },
    );
    const received: number[] = [];
    bus.on(decl, (payload) => received.push(payload.value));

    expect(() =>
      bus.emit(decl, { value: "nope" } as unknown as never),
    ).toThrow(/payload\.value must be number/);
    expect(received).toEqual([]);
  });

  it("validates string emits whose event name is module-owned", () => {
    const bus = initEventBus();
    const decl = defineDaemonWideModuleEvent<{ value: number }>(
      "registered.strict",
      ["value"],
      {
        payloadSchema: {
          type: "object",
          properties: { value: { type: "number" } },
        },
      },
    );
    initModuleEventRegistry().register("strict-module", decl);

    expect(() => bus.emit("registered.strict", { value: "bad" })).toThrow(
      /registered\.strict.*payload\.value must be number/,
    );
  });

  it("rejects emit of a project-scoped module event without a scope selector", () => {
    const bus = initEventBus();
    const decl = defineProjectScopedModuleEvent<{ value: number }>(
      "scoped.event",
      ["value"],
    );
    // Cast bypasses the typed overload to exercise the runtime guard against a
    // payload that genuinely omits both scope selectors.
    expect(() =>
      bus.emit(decl, { value: 1 } as unknown as never),
    ).toThrow(/project-scoped/);
  });

  it("accepts emit of a project-scoped module event when both selectors are present", () => {
    const bus = initEventBus();
    const decl = defineProjectScopedModuleEvent<{ value: number }>(
      "scoped.ok",
      ["value"],
    );
    const received: { scopeId: string; projectId: string; value: number }[] = [];
    bus.on(decl, (payload) => received.push(payload));
    bus.emit(decl, { scopeId: "p1", projectId: "p1", value: 5 });
    expect(received).toEqual([{ scopeId: "p1", projectId: "p1", value: 5 }]);
  });

  it("keeps raw projectId-only emits as compatibility callers", () => {
    const bus = initEventBus();
    const decl = defineProjectScopedModuleEvent<{ value: number }>(
      "scoped.compat",
      ["value"],
    );
    const received: { projectId?: string; value: number }[] = [];
    bus.on(decl, (payload) => received.push(payload));
    bus.emit(decl, { projectId: "p1", value: 5 } as unknown as never);
    expect(received).toEqual([{ projectId: "p1", value: 5 }]);
  });

  it("rejects conflicting raw scope selectors", () => {
    const bus = initEventBus();
    const decl = defineProjectScopedModuleEvent<{ value: number }>(
      "scoped.conflict",
      ["value"],
    );
    expect(() =>
      bus.emit(
        decl,
        { scopeId: "p1", projectId: "p2", value: 5 } as unknown as never,
      ),
    ).toThrow(/conflicting scope selectors/);
  });
});
