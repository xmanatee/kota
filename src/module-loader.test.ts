import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "./event-bus.js";
import { ModuleLoader } from "./module-loader.js";
import type { KotaModule } from "./module-types.js";
import { clearCustomGroups, enableGroup, filterTools, resetGroups, TOOL_GROUPS } from "./tool-groups.js";
import { allTools, clearCustomTools, executeTool } from "./tools/index.js";

function makeTool(name: string) {
  return {
    tool: {
      name,
      description: `Test tool: ${name}`,
      input_schema: { type: "object" as const, properties: {} },
    },
    runner: async () => ({ content: `result from ${name}` }),
  };
}

describe("ModuleLoader", () => {
  beforeEach(() => {
    clearCustomTools();
    clearCustomGroups();
    resetGroups();
  });

  afterEach(() => {
    clearCustomTools();
    clearCustomGroups();
    resetGroups();
  });

  it("loads a module with tools", async () => {
    const loader = new ModuleLoader({});
    const mod: KotaModule = {
      name: "test-mod",
      tools: [makeTool("test_tool")],
    };

    await loader.load(mod);
    expect(loader.getLoadedModules()).toEqual(["test-mod"]);
    expect(loader.getModuleCount()).toBe(1);
    expect(loader.getToolCount()).toBe(1);

    const result = await executeTool("test_tool", {});
    expect(result.content).toBe("result from test_tool");
  });

  it("registers tools into groups via group field", async () => {
    const loader = new ModuleLoader({});
    const mod: KotaModule = {
      name: "grouped-mod",
      tools: [{ ...makeTool("grouped_tool"), group: "test_group" }],
    };

    await loader.load(mod);
    expect(TOOL_GROUPS.test_group).toContain("grouped_tool");

    // Tool hidden until group enabled
    const before = filterTools(allTools);
    expect(before.some((t) => t.name === "grouped_tool")).toBe(false);

    enableGroup("test_group");
    const after = filterTools(allTools);
    expect(after.some((t) => t.name === "grouped_tool")).toBe(true);
  });

  it("rejects duplicate module names", async () => {
    const loader = new ModuleLoader({});
    await loader.load({ name: "dup" });
    await expect(loader.load({ name: "dup" })).rejects.toThrow(
      'Duplicate module name: "dup"',
    );
  });

  it("rejects modules with missing dependencies", async () => {
    const loader = new ModuleLoader({});
    const mod: KotaModule = {
      name: "dependent",
      dependencies: ["missing-dep"],
    };
    await expect(loader.load(mod)).rejects.toThrow(
      'Module "dependent" requires "missing-dep" which is not loaded',
    );
  });

  it("loads dependencies before dependents via loadAll", async () => {
    const loader = new ModuleLoader({});
    const loadOrder: string[] = [];

    const dep: KotaModule = {
      name: "base",
      onLoad: () => { loadOrder.push("base"); },
    };
    const dependent: KotaModule = {
      name: "ext",
      dependencies: ["base"],
      onLoad: () => { loadOrder.push("ext"); },
    };

    // Intentionally pass in wrong order
    await loader.loadAll([dependent, dep]);
    expect(loadOrder).toEqual(["base", "ext"]);
    expect(loader.getLoadedModules()).toEqual(["base", "ext"]);
  });

  it("calls onLoad with ModuleContext", async () => {
    const onLoad = vi.fn();
    const loader = new ModuleLoader({ model: "test-model" }, true);
    await loader.load({ name: "ctx-test", onLoad });

    expect(onLoad).toHaveBeenCalledOnce();
    const ctx = onLoad.mock.calls[0][0];
    expect(ctx.cwd).toBeTruthy();
    expect(typeof ctx.verbose).toBe("boolean");
    expect(typeof ctx.registerGroup).toBe("function");
    expect(ctx.config).toEqual({ model: "test-model" });
  });

  it("calls onUnload in reverse order during unloadAll", async () => {
    const unloadOrder: string[] = [];
    const loader = new ModuleLoader({});

    await loader.loadAll([
      { name: "first", onUnload: () => { unloadOrder.push("first"); } },
      { name: "second", onUnload: () => { unloadOrder.push("second"); } },
      { name: "third", onUnload: () => { unloadOrder.push("third"); } },
    ]);

    await loader.unloadAll();
    expect(unloadOrder).toEqual(["third", "second", "first"]);
    expect(loader.getModuleCount()).toBe(0);
  });

  it("cleans up tools on unloadAll", async () => {
    const loader = new ModuleLoader({});
    await loader.load({
      name: "cleanup-mod",
      tools: [makeTool("cleanup_tool")],
    });

    const result1 = await executeTool("cleanup_tool", {});
    expect(result1.content).toBe("result from cleanup_tool");

    await loader.unloadAll();
    const result2 = await executeTool("cleanup_tool", {});
    expect(result2.is_error).toBe(true);
  });

  it("collects CLI commands from modules", async () => {
    const { Command } = await import("commander");
    const loader = new ModuleLoader({});

    await loader.load({
      name: "cmd-mod",
      commands: () => [
        new Command("test-cmd").description("A test command"),
      ],
    });

    const commands = loader.getCommands();
    expect(commands).toHaveLength(1);
    expect(commands[0].name()).toBe("test-cmd");
  });

  it("collects HTTP routes from modules", async () => {
    const handler = vi.fn();
    const loader = new ModuleLoader({});

    await loader.load({
      name: "route-mod",
      routes: () => [
        { method: "GET", path: "/api/test", handler },
        { method: "POST", path: "/api/test", handler },
      ],
    });

    const routes = loader.getRoutes();
    expect(routes).toHaveLength(2);
    expect(routes[0]).toEqual({ method: "GET", path: "/api/test", handler });
  });

  it("connects and disconnects event subscriptions", async () => {
    const bus = new EventBus();
    const received: string[] = [];
    const loader = new ModuleLoader({});

    await loader.load({
      name: "event-mod",
      events: (b) => [
        b.on("session.start", (payload) => {
          received.push(payload.sessionId);
        }),
      ],
    });

    loader.connectEvents(bus);
    bus.emit("session.start", { sessionId: "s1" });
    expect(received).toEqual(["s1"]);

    // After unload, events should be disconnected
    await loader.unloadAll();
    bus.emit("session.start", { sessionId: "s2" });
    expect(received).toEqual(["s1"]); // s2 NOT received
  });

  it("handles module load errors gracefully in loadAll", async () => {
    const loader = new ModuleLoader({});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await loader.loadAll([
      {
        name: "bad-mod",
        onLoad: () => { throw new Error("boom"); },
      },
      { name: "good-mod" },
    ]);

    // Bad module failed, good module loaded
    expect(loader.getLoadedModules()).toEqual(["good-mod"]);
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining('Module "bad-mod" failed to load: boom'),
    );
    errSpy.mockRestore();
  });

  it("handles onUnload errors gracefully", async () => {
    const loader = new ModuleLoader({});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await loader.load({
      name: "bad-unload",
      onUnload: () => { throw new Error("cleanup failed"); },
    });

    await loader.unloadAll();
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining('Module "bad-unload" unload error: cleanup failed'),
    );
    errSpy.mockRestore();
  });
});

describe("scheduler module integration", () => {
  beforeEach(() => {
    clearCustomTools();
    clearCustomGroups();
    resetGroups();
  });

  afterEach(() => {
    clearCustomTools();
    clearCustomGroups();
    resetGroups();
  });

  it("registers the schedule tool via module protocol", async () => {
    const { default: schedulerModule } = await import("./modules/scheduler.js");
    const loader = new ModuleLoader({});

    await loader.load(schedulerModule);
    expect(loader.getLoadedModules()).toEqual(["scheduler"]);
    expect(loader.getToolCount()).toBe(1);

    // Schedule tool should be in the management group
    expect(TOOL_GROUPS.management).toContain("schedule");

    // Should be callable
    const result = await executeTool("schedule", { action: "list" });
    expect(result.is_error).toBeFalsy();
  });

  it("schedule tool is hidden until management group is enabled", async () => {
    const { default: schedulerModule } = await import("./modules/scheduler.js");
    const loader = new ModuleLoader({});
    await loader.load(schedulerModule);

    const before = filterTools(allTools);
    expect(before.some((t) => t.name === "schedule")).toBe(false);

    enableGroup("management");
    const after = filterTools(allTools);
    expect(after.some((t) => t.name === "schedule")).toBe(true);
  });
});

describe("memory module integration", () => {
  beforeEach(() => {
    clearCustomTools();
    clearCustomGroups();
    resetGroups();
  });

  afterEach(() => {
    clearCustomTools();
    clearCustomGroups();
    resetGroups();
  });

  it("registers the memory tool via module protocol", async () => {
    const { default: memoryModule } = await import("./modules/memory.js");
    const loader = new ModuleLoader({});

    await loader.load(memoryModule);
    expect(loader.getLoadedModules()).toEqual(["memory"]);
    expect(loader.getToolCount()).toBe(1);

    // Memory tool should be in the management group
    expect(TOOL_GROUPS.management).toContain("memory");

    // Should be callable
    const result = await executeTool("memory", { action: "list" });
    expect(result.is_error).toBeFalsy();
  });

  it("memory tool is hidden until management group is enabled", async () => {
    const { default: memoryModule } = await import("./modules/memory.js");
    const loader = new ModuleLoader({});
    await loader.load(memoryModule);

    const before = filterTools(allTools);
    expect(before.some((t) => t.name === "memory")).toBe(false);

    enableGroup("management");
    const after = filterTools(allTools);
    expect(after.some((t) => t.name === "memory")).toBe(true);
  });
});
