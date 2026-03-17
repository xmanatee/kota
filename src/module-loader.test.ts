import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus, initEventBus, resetEventBus } from "./event-bus.js";
import { ModuleLoader } from "./module-loader.js";
import type { KotaModule } from "./module-types.js";
import { clearCustomGroups, enableGroup, filterTools, resetGroups, TOOL_GROUPS } from "./tool-groups.js";
import { clearCustomTools, executeTool, getAllTools } from "./tools/index.js";

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
    const before = filterTools(getAllTools());
    expect(before.some((t) => t.name === "grouped_tool")).toBe(false);

    enableGroup("test_group");
    const after = filterTools(getAllTools());
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

  it("calls onLoad with ModuleContext including getRoutes", async () => {
    const onLoad = vi.fn();
    const loader = new ModuleLoader({ model: "test-model" }, true);
    await loader.load({ name: "ctx-test", onLoad });

    expect(onLoad).toHaveBeenCalledOnce();
    const ctx = onLoad.mock.calls[0][0];
    expect(ctx.cwd).toBeTruthy();
    expect(typeof ctx.verbose).toBe("boolean");
    expect(typeof ctx.registerGroup).toBe("function");
    expect(typeof ctx.getRoutes).toBe("function");
    expect(ctx.config).toEqual({ model: "test-model" });
  });

  it("getRoutes in context returns routes from all loaded modules", async () => {
    const handler = vi.fn();
    const loader = new ModuleLoader({});

    await loader.load({
      name: "route-provider",
      routes: () => [{ method: "POST", path: "/api/test", handler }],
    });

    // A module's commands() can use ctx.getRoutes() to discover routes
    let discoveredRoutes: any[] = [];
    const { Command } = await import("commander");
    await loader.load({
      name: "route-consumer",
      commands: (ctx) => {
        discoveredRoutes = ctx.getRoutes();
        return [new Command("test-cmd")];
      },
    });

    loader.getCommands(); // triggers commands() calls
    expect(discoveredRoutes).toHaveLength(1);
    expect(discoveredRoutes[0].path).toBe("/api/test");
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

  it("commandsOnly mode skips tool registration and onLoad", async () => {
    const onLoad = vi.fn();
    const loader = new ModuleLoader({}, false, { commandsOnly: true });
    const { Command } = await import("commander");

    await loader.load({
      name: "cmd-only-mod",
      tools: [makeTool("should_not_register")],
      onLoad,
      commands: () => [new Command("my-cmd").description("test")],
    });

    // Module is loaded (tracked)
    expect(loader.getLoadedModules()).toEqual(["cmd-only-mod"]);
    // But tools are NOT registered
    expect(loader.getToolCount()).toBe(0);
    const result = await executeTool("should_not_register", {});
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("Unknown tool");
    // And onLoad was NOT called
    expect(onLoad).not.toHaveBeenCalled();
    // Commands still work
    const cmds = loader.getCommands();
    expect(cmds).toHaveLength(1);
    expect(cmds[0].name()).toBe("my-cmd");
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

  it("unloads a single module and deregisters its tools", async () => {
    const loader = new ModuleLoader({});
    await loader.load({
      name: "mod-a",
      tools: [makeTool("tool_a")],
    });
    await loader.load({ name: "mod-b", tools: [makeTool("tool_b")] });

    expect(loader.getLoadedModules()).toEqual(["mod-a", "mod-b"]);

    // tool_a works before unload
    const r1 = await executeTool("tool_a", {});
    expect(r1.content).toBe("result from tool_a");

    await loader.unload("mod-a");
    expect(loader.getLoadedModules()).toEqual(["mod-b"]);

    // tool_a gone, tool_b still works
    const r2 = await executeTool("tool_a", {});
    expect(r2.is_error).toBe(true);
    const r3 = await executeTool("tool_b", {});
    expect(r3.content).toBe("result from tool_b");
  });

  it("unload returns false for unknown module", async () => {
    const loader = new ModuleLoader({});
    expect(await loader.unload("nonexistent")).toBe(false);
  });

  it("unload rejects when dependents exist", async () => {
    const loader = new ModuleLoader({});
    await loader.load({ name: "base" });
    await loader.load({ name: "child", dependencies: ["base"] });

    await expect(loader.unload("base")).rejects.toThrow(
      'Cannot unload "base": depended on by "child"',
    );
  });

  it("unload calls onUnload and disconnects events", async () => {
    const bus = new EventBus();
    const unloadCalled = vi.fn();
    const received: string[] = [];
    const loader = new ModuleLoader({});

    await loader.load({
      name: "evt-mod",
      onUnload: unloadCalled,
      events: (b) => [
        b.on("session.start", (p) => { received.push(p.sessionId); }),
      ],
    });

    loader.connectEvents(bus);
    bus.emit("session.start", { sessionId: "before" });
    expect(received).toEqual(["before"]);

    await loader.unload("evt-mod");
    expect(unloadCalled).toHaveBeenCalledOnce();

    bus.emit("session.start", { sessionId: "after" });
    expect(received).toEqual(["before"]); // not received after unload
  });

  it("reloads a module — re-registers tools and calls onLoad again", async () => {
    const onLoad = vi.fn();
    const loader = new ModuleLoader({});

    await loader.load({
      name: "reload-mod",
      tools: [makeTool("reload_tool")],
      onLoad,
    });
    expect(onLoad).toHaveBeenCalledTimes(1);

    const r1 = await executeTool("reload_tool", {});
    expect(r1.content).toBe("result from reload_tool");

    const reloaded = await loader.reload("reload-mod");
    expect(reloaded).toBe(true);
    expect(onLoad).toHaveBeenCalledTimes(2);
    expect(loader.getLoadedModules()).toEqual(["reload-mod"]);

    // Tool still works after reload
    const r2 = await executeTool("reload_tool", {});
    expect(r2.content).toBe("result from reload_tool");
  });

  it("reload returns false for unknown module", async () => {
    const loader = new ModuleLoader({});
    expect(await loader.reload("nonexistent")).toBe(false);
  });

  it("reload reconnects events when bus is available", async () => {
    const bus = new EventBus();
    const received: string[] = [];
    const loader = new ModuleLoader({});

    await loader.load({
      name: "evt-reload",
      events: (b) => [
        b.on("session.start", (p) => { received.push(p.sessionId); }),
      ],
    });

    loader.connectEvents(bus);
    bus.emit("session.start", { sessionId: "s1" });
    expect(received).toEqual(["s1"]);

    await loader.reload("evt-reload");
    bus.emit("session.start", { sessionId: "s2" });
    expect(received).toEqual(["s1", "s2"]);
  });

  it("getDependents returns correct dependents", async () => {
    const loader = new ModuleLoader({});
    await loader.load({ name: "core" });
    await loader.load({ name: "ext-a", dependencies: ["core"] });
    await loader.load({ name: "ext-b", dependencies: ["core"] });
    await loader.load({ name: "standalone" });

    expect(loader.getDependents("core").sort()).toEqual(["ext-a", "ext-b"]);
    expect(loader.getDependents("standalone")).toEqual([]);
    expect(loader.getDependents("ext-a")).toEqual([]);
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

    const before = filterTools(getAllTools());
    expect(before.some((t) => t.name === "schedule")).toBe(false);

    enableGroup("management");
    const after = filterTools(getAllTools());
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

    const before = filterTools(getAllTools());
    expect(before.some((t) => t.name === "memory")).toBe(false);

    enableGroup("management");
    const after = filterTools(getAllTools());
    expect(after.some((t) => t.name === "memory")).toBe(true);
  });
});

describe("getRoutes reentrancy guard", () => {
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

  it("returns empty array instead of infinite recursion when routes() calls ctx.getRoutes()", async () => {
    const loader = new ModuleLoader({});
    const handler = vi.fn();

    // Module A provides a route normally
    await loader.load({
      name: "route-a",
      routes: () => [{ method: "GET", path: "/a", handler }],
    });

    // Module B tries to call ctx.getRoutes() from within its own routes()
    // Without the guard, this would infinite-recurse
    let innerRoutes: any[] = [];
    await loader.load({
      name: "route-b",
      routes: (ctx) => {
        innerRoutes = ctx.getRoutes();
        return [{ method: "GET", path: "/b", handler }];
      },
    });

    const routes = loader.getRoutes();
    // Both routes should be collected
    expect(routes).toHaveLength(2);
    expect(routes.map((r) => r.path).sort()).toEqual(["/a", "/b"]);
    // Inner call returned empty (guard prevented recursion)
    expect(innerRoutes).toEqual([]);
  });

  it("allows getRoutes() after a previous call completes", async () => {
    const loader = new ModuleLoader({});
    const handler = vi.fn();

    await loader.load({
      name: "route-mod",
      routes: () => [{ method: "GET", path: "/test", handler }],
    });

    // First call
    const routes1 = loader.getRoutes();
    expect(routes1).toHaveLength(1);

    // Second call should work (guard reset)
    const routes2 = loader.getRoutes();
    expect(routes2).toHaveLength(1);
  });

  it("resets guard even if routes() throws", async () => {
    const loader = new ModuleLoader({});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const handler = vi.fn();

    await loader.load({
      name: "throws-mod",
      routes: () => { throw new Error("bad routes"); },
    });
    await loader.load({
      name: "good-mod",
      routes: () => [{ method: "GET", path: "/ok", handler }],
    });

    // First call — throws-mod errors but guard should still reset
    const routes1 = loader.getRoutes();
    expect(routes1).toHaveLength(1);

    // Second call should still work
    const routes2 = loader.getRoutes();
    expect(routes2).toHaveLength(1);

    errSpy.mockRestore();
  });
});

describe("Module SDK — storage, config, promptSection", () => {
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

  it("provides scoped storage via ModuleContext", async () => {
    const onLoad = vi.fn();
    const loader = new ModuleLoader({}, false);
    await loader.load({ name: "storage-mod", onLoad });

    const ctx = onLoad.mock.calls[0][0];
    expect(ctx.storage).toBeDefined();
    expect(ctx.storage.getDir()).toContain(".kota/modules/storage-mod");
  });

  it("each module gets its own isolated storage", async () => {
    const onLoadA = vi.fn();
    const onLoadB = vi.fn();
    const loader = new ModuleLoader({});
    await loader.load({ name: "mod-a", onLoad: onLoadA });
    await loader.load({ name: "mod-b", onLoad: onLoadB });

    const storageA = onLoadA.mock.calls[0][0].storage;
    const storageB = onLoadB.mock.calls[0][0].storage;
    expect(storageA.getDir()).not.toBe(storageB.getDir());
    expect(storageA.getDir()).toContain("mod-a");
    expect(storageB.getDir()).toContain("mod-b");
  });

  it("getModuleConfig returns the module's config section", async () => {
    const onLoad = vi.fn();
    const loader = new ModuleLoader({
      modules: {
        "my-mod": { apiKey: "secret", retries: 3 },
      },
    });
    await loader.load({ name: "my-mod", onLoad });

    const ctx = onLoad.mock.calls[0][0];
    const config = ctx.getModuleConfig();
    expect(config).toEqual({ apiKey: "secret", retries: 3 });
  });

  it("getModuleConfig returns undefined when no config exists", async () => {
    const onLoad = vi.fn();
    const loader = new ModuleLoader({});
    await loader.load({ name: "no-config", onLoad });

    const ctx = onLoad.mock.calls[0][0];
    expect(ctx.getModuleConfig()).toBeUndefined();
  });

  it("collects promptSection from modules", async () => {
    const loader = new ModuleLoader({});
    await loader.load({
      name: "helper-mod",
      promptSection: () => "Use the helper tool for quick lookups.",
    });

    const sections = loader.getPromptSections();
    expect(sections).toContain("## Module Capabilities");
    expect(sections).toContain("### helper-mod");
    expect(sections).toContain("Use the helper tool for quick lookups.");
  });

  it("skips promptSection that returns undefined", async () => {
    const loader = new ModuleLoader({});
    await loader.load({
      name: "silent-mod",
      promptSection: () => undefined,
    });

    expect(loader.getPromptSections()).toBe("");
  });

  it("handles promptSection errors gracefully", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const loader = new ModuleLoader({});
    await loader.load({
      name: "bad-prompt",
      promptSection: () => { throw new Error("prompt boom"); },
    });

    expect(loader.getPromptSections()).toBe("");
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining('Module "bad-prompt" promptSection failed'),
    );
    errSpy.mockRestore();
  });

  it("collects multiple prompt sections in load order", async () => {
    const loader = new ModuleLoader({});
    await loader.load({
      name: "mod-a",
      promptSection: () => "Section A content.",
    });
    await loader.load({
      name: "mod-b",
      promptSection: () => "Section B content.",
    });

    const sections = loader.getPromptSections();
    const idxA = sections.indexOf("### mod-a");
    const idxB = sections.indexOf("### mod-b");
    expect(idxA).toBeLessThan(idxB);
    expect(sections).toContain("Section A content.");
    expect(sections).toContain("Section B content.");
  });

  it("removes prompt section on module unload", async () => {
    const loader = new ModuleLoader({});
    await loader.load({
      name: "removable",
      promptSection: () => "Removable content.",
    });

    expect(loader.getPromptSections()).toContain("Removable content.");

    await loader.unload("removable");
    expect(loader.getPromptSections()).toBe("");
  });

  it("getModuleStorage returns storage for loaded module", async () => {
    const loader = new ModuleLoader({});
    await loader.load({ name: "stored-mod" });

    const storage = loader.getModuleStorage("stored-mod");
    expect(storage).toBeDefined();
    expect(storage!.getDir()).toContain("stored-mod");
  });

  it("getModuleStorage returns undefined for unknown module", () => {
    const loader = new ModuleLoader({});
    expect(loader.getModuleStorage("unknown")).toBeUndefined();
  });

  it("cleans up storage references on unloadAll", async () => {
    const loader = new ModuleLoader({});
    await loader.load({ name: "cleanup-storage" });
    expect(loader.getModuleStorage("cleanup-storage")).toBeDefined();

    await loader.unloadAll();
    expect(loader.getModuleStorage("cleanup-storage")).toBeUndefined();
  });

  it("commandsOnly mode skips promptSection collection", async () => {
    const loader = new ModuleLoader({}, false, { commandsOnly: true });
    await loader.load({
      name: "skip-prompt",
      promptSection: () => "Should not appear.",
    });

    expect(loader.getPromptSections()).toBe("");
  });
});

describe("module event bus integration", () => {
  beforeEach(() => {
    clearCustomTools();
    clearCustomGroups();
    resetGroups();
    resetEventBus();
  });

  afterEach(() => {
    clearCustomTools();
    clearCustomGroups();
    resetGroups();
    resetEventBus();
  });

  it("connectEvents wires module event subscriptions to the singleton bus", async () => {
    const bus = initEventBus();
    const received: string[] = [];
    const loader = new ModuleLoader({});

    await loader.load({
      name: "bus-mod",
      events: (b) => [
        b.on("session.start", (p) => { received.push(p.sessionId); }),
      ],
    });

    // Before connectEvents — bus exists but module isn't wired
    bus.emit("session.start", { sessionId: "before-connect" });
    expect(received).toEqual([]);

    // After connectEvents — module receives events
    loader.connectEvents(bus);
    bus.emit("session.start", { sessionId: "after-connect" });
    expect(received).toEqual(["after-connect"]);
  });

  it("module events are cleaned up on unloadAll", async () => {
    const bus = initEventBus();
    const received: string[] = [];
    const loader = new ModuleLoader({});

    await loader.load({
      name: "cleanup-evt",
      events: (b) => [
        b.on("session.end", (p) => { received.push(p.sessionId); }),
      ],
    });

    loader.connectEvents(bus);
    bus.emit("session.end", { sessionId: "s1", durationMs: 100 });
    expect(received).toEqual(["s1"]);

    await loader.unloadAll();
    bus.emit("session.end", { sessionId: "s2", durationMs: 200 });
    expect(received).toEqual(["s1"]); // not received after cleanup
  });
});
