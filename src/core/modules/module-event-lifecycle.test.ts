import { afterEach, describe, expect, it, vi } from "vitest";
import { EventBus, initEventBus, resetEventBus } from "#core/events/event-bus.js";
import { clearCustomTools } from "#core/tools/index.js";
import { ModuleLoader } from "./module-loader.js";
import type { KotaModule, ModuleContext } from "./module-types.js";
import { resetProviderRegistry } from "./provider-registry.js";
import { loadRuntimeModules } from "./runtime-loader.js";

afterEach(() => {
  clearCustomTools();
  resetProviderRegistry();
  resetEventBus();
});

function runtimeLoader(bus = new EventBus()): ModuleLoader {
  const loader = new ModuleLoader({});
  loader.setBus(bus);
  return loader;
}

describe("runtime module event lifecycle", () => {
  it("rejects runtime host initialization without event authority", async () => {
    await expect(loadRuntimeModules({
      config: {},
      cwd: process.cwd(),
      eventBus: undefined as never,
    })).rejects.toThrow(/requires the host EventBus before lifecycle execution/);
  });

  it("rejects direct runtime loading before onLoad instead of borrowing the process singleton", async () => {
    initEventBus();
    const onLoad = vi.fn();
    const loader = new ModuleLoader({}, false, { mode: "runtime" });

    await expect(loader.load({
      name: "unbound-runtime",
      onLoad: (ctx) => {
        onLoad();
        ctx.events.subscribeExternal("unbound.event", () => {});
      },
    })).rejects.toThrow(/requires a bound runtime EventBus before module lifecycle execution/);
    expect(onLoad).not.toHaveBeenCalled();
    expect(loader.getLoadedModules()).toEqual([]);
  });

  it("rejects an empty runtime loadAll without event authority", async () => {
    const loader = new ModuleLoader({}, false, { mode: "runtime" });

    await expect(loader.loadAll([])).rejects.toThrow(
      /requires a bound runtime EventBus before module lifecycle execution/,
    );
  });

  it("fails every event-proxy operation when no bus is bound", async () => {
    const loader = new ModuleLoader({}, false, { mode: "commands" });
    let context: ModuleContext | undefined;
    await loader.load({
      name: "unbound-contribution",
      commands: (ctx) => {
        context = ctx;
        return [];
      },
    });
    expect(context).toBeDefined();
    const failure = {
      projectId: "scope-a",
      workflow: "builder",
      runId: "missing-bus",
      status: "failed" as const,
      durationMs: 1,
      errorSummary: "missing bus",
      text: "missing bus",
    };

    expect(() => context!.events.emit("workflow.failure.alert", failure)).toThrow(
      /requires a bound runtime EventBus/,
    );
    expect(() => context!.events.subscribe("workflow.failure.alert", () => {})).toThrow(
      /requires a bound runtime EventBus/,
    );
    expect(() => context!.events.emitExternal("external.event", {})).toThrow(
      /requires a bound runtime EventBus/,
    );
    expect(() => context!.events.subscribeExternal("external.event", () => {})).toThrow(
      /requires a bound runtime EventBus/,
    );
    expect(() => context!.events.listenerCount()).toThrow(
      /requires a bound runtime EventBus/,
    );
  });

  it("keeps one immutable authority and one listener generation across reload", async () => {
    const bus = new EventBus();
    const loader = runtimeLoader(bus);
    const received = vi.fn();
    const module: KotaModule = {
      name: "subscription-owner",
      onLoad: (ctx) => {
        ctx.events.subscribeExternal("owned.event", received);
      },
    };

    await loader.load(module);
    expect(() => loader.setBus(bus)).not.toThrow();
    expect(() => loader.setBus(new EventBus())).toThrow(/must be bound before loading/);
    expect(bus.listenerCount("owned.event")).toBe(1);
    bus.emit("owned.event", { generation: 1 });

    await loader.reload(module.name);
    expect(bus.listenerCount("owned.event")).toBe(1);
    bus.emit("owned.event", { generation: 2 });
    expect(received).toHaveBeenCalledTimes(2);

    await loader.unload(module.name);
    expect(bus.listenerCount("owned.event")).toBe(0);
  });

  it("makes explicit unsubscribe idempotent and removes remaining listeners on unloadAll", async () => {
    const bus = new EventBus();
    const loader = runtimeLoader(bus);
    let unsubscribe: (() => void) | undefined;
    await loader.loadAll([
      {
        name: "subscriber-a",
        onLoad: (ctx) => {
          unsubscribe = ctx.events.subscribeExternal("owned.shared", () => {});
        },
      },
      {
        name: "subscriber-b",
        onLoad: (ctx) => {
          ctx.events.subscribeExternal("owned.shared", () => {});
        },
      },
    ]);
    expect(bus.listenerCount("owned.shared")).toBe(2);

    unsubscribe!();
    unsubscribe!();
    expect(bus.listenerCount("owned.shared")).toBe(1);
    await loader.unloadAll();
    expect(bus.listenerCount("owned.shared")).toBe(0);
  });

  it("rolls back listeners when module initialization fails", async () => {
    const bus = new EventBus();
    const loader = runtimeLoader(bus);
    await expect(loader.load({
      name: "failed-subscriber",
      onLoad: (ctx) => {
        ctx.events.subscribeExternal("owned.failed", () => {});
        throw new Error("initialization failed");
      },
    })).rejects.toThrow("initialization failed");

    expect(bus.listenerCount("owned.failed")).toBe(0);
  });

  it("rolls back earlier modules when aggregate runtime initialization fails", async () => {
    const bus = new EventBus();
    const loader = runtimeLoader(bus);
    const onUnload = vi.fn();
    await loader.load({
      name: "existing-subscriber",
      onLoad: (ctx) => {
        ctx.events.subscribeExternal("owned.existing", () => {});
      },
    });

    await expect(loader.loadAll([
      {
        name: "aggregate-subscriber",
        onLoad: (ctx) => {
          ctx.events.subscribeExternal("owned.aggregate", () => {});
        },
        onUnload,
      },
      {
        name: "aggregate-failure",
        dependencies: ["aggregate-subscriber"],
        onLoad: () => {
          throw new Error("aggregate initialization failed");
        },
      },
    ])).rejects.toThrow(/aggregate initialization failed/);

    expect(bus.listenerCount("owned.aggregate")).toBe(0);
    expect(bus.listenerCount("owned.existing")).toBe(1);
    expect(loader.getLoadedModules()).toEqual([
      "existing-subscriber",
      "aggregate-subscriber",
    ]);
    expect(onUnload).not.toHaveBeenCalled();
  });
});
