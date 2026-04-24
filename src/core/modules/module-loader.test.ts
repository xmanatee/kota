import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "#core/events/event-bus.js";
import { clearCustomTools, executeTool, getAllTools } from "#core/tools/index.js";
import { clearCustomGroups, enableGroup, filterTools, resetGroups, TOOL_GROUPS } from "#core/tools/tool-groups.js";
import { ModuleLoader } from "./module-loader.js";
import type { KotaModule } from "./module-types.js";
import { resetProviderRegistry } from "./provider-registry.js";

function makeTool(name: string, opts?: { risk?: "safe" | "moderate" | "dangerous"; kind?: "discovery" | "action" }) {
  return {
    tool: {
      name,
      description: `Test tool: ${name}`,
      input_schema: { type: "object" as const, properties: {} },
    },
    runner: async () => ({ content: `result from ${name}` }),
    risk: opts?.risk ?? ("safe" as const),
    kind: opts?.kind ?? ("discovery" as const),
  };
}

function makeToolWithoutMeta(name: string) {
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

  it("rejects a tool missing risk metadata", async () => {
    const loader = new ModuleLoader({});
    const mod: KotaModule = {
      name: "no-risk-mod",
      tools: [makeToolWithoutMeta("no_risk_tool") as any],
    };

    await expect(loader.load(mod)).rejects.toThrow("missing required metadata: risk, kind");
  });

  it("rejects a tool missing kind metadata", async () => {
    const loader = new ModuleLoader({});
    const mod: KotaModule = {
      name: "no-kind-mod",
      tools: [{ ...makeToolWithoutMeta("no_kind_tool"), risk: "safe" } as any],
    };

    await expect(loader.load(mod)).rejects.toThrow("missing required metadata: kind");
  });

  it("loads a tool with complete metadata", async () => {
    const loader = new ModuleLoader({});
    const mod: KotaModule = {
      name: "annotated-mod",
      tools: [makeTool("annotated_tool")],
    };

    await loader.load(mod);
    expect(loader.getToolCount()).toBe(1);
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

  it("collects workflow definitions from modules and exposes via getContributedWorkflows", async () => {
    const loader = new ModuleLoader({});

    await loader.load({
      name: "workflow-provider",
      workflows: [
        {
          name: "workflow-provider/my-job",
          triggers: [{ event: "runtime.idle", cooldownMs: 60_000 }],
          steps: [{ id: "noop", type: "code", run: () => {} }],
        },
      ],
    });

    const workflows = loader.getContributedWorkflows();
    expect(workflows).toHaveLength(1);
    expect(workflows[0].name).toBe("workflow-provider/my-job");
    expect(workflows[0].definitionPath).toBe("modules/workflow-provider");
  });

  it("collects channel definitions from modules and exposes via getContributedChannels", async () => {
    const loader = new ModuleLoader({});
    const mockCreate = () => null;

    await loader.load({
      name: "channel-provider",
      channels: [{ name: "test-channel", description: "A test channel", create: mockCreate }],
    });

    const channels = loader.getContributedChannels();
    expect(channels).toHaveLength(1);
    expect(channels[0].name).toBe("test-channel");
  });

  it("exposes contributed workflows via ctx.getContributedWorkflows()", async () => {
    const loader = new ModuleLoader({});

    await loader.load({
      name: "wf-ext",
      workflows: [
        {
          name: "wf-ext/heartbeat",
          triggers: [{ intervalMs: 300_000 }],
          steps: [{ id: "noop", type: "code", run: () => {} }],
        },
      ],
    });

    let discoveredWorkflows: any[] = [];
    await loader.load({
      name: "wf-consumer",
      onLoad: (ctx) => {
        discoveredWorkflows = ctx.getContributedWorkflows();
      },
    });

    expect(discoveredWorkflows).toHaveLength(1);
    expect(discoveredWorkflows[0].name).toBe("wf-ext/heartbeat");
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

  it("project module load failure throws from loadAll", async () => {
    const loader = new ModuleLoader({});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      loader.loadAll([
        {
          name: "bad-mod",
          onLoad: () => { throw new Error("boom"); },
        },
        { name: "good-mod" },
      ]),
    ).rejects.toThrow("1 project module(s) failed to load");

    // Good module still loaded despite the throw
    expect(loader.getLoadedModules()).toEqual(["good-mod"]);
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining('Module "bad-mod" failed to load: boom'),
    );
    errSpy.mockRestore();
  });

  it("installed module load failure is non-fatal in loadAll", async () => {
    const loader = new ModuleLoader({});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await loader.loadAll(
      [{ name: "good-mod" }],
      [{
        name: "bad-installed",
        onLoad: () => { throw new Error("missing creds"); },
      }],
    );

    expect(loader.getLoadedModules()).toEqual(["good-mod"]);
    expect(errSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("bad-installed"),
    );
    errSpy.mockRestore();
  });

  it("installed module load failure logs in verbose mode", async () => {
    const loader = new ModuleLoader({}, true);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await loader.loadAll(
      [{ name: "good-mod" }],
      [{
        name: "bad-installed",
        onLoad: () => { throw new Error("missing creds"); },
      }],
    );

    expect(loader.getLoadedModules()).toEqual(["good-mod"]);
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining('Optional module "bad-installed" skipped'),
    );
    errSpy.mockRestore();
  });

  it("records load failures with source in getModuleSummaries", async () => {
    const loader = new ModuleLoader({});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await loader.loadAll(
      [{ name: "good-mod" }],
      [{
        name: "bad-installed",
        onLoad: () => { throw new Error("it broke"); },
      }],
    );

    const summaries = loader.getModuleSummaries();
    const goodSummary = summaries.find((s) => s.name === "good-mod");
    const badSummary = summaries.find((s) => s.name === "bad-installed");

    expect(goodSummary).toBeDefined();
    expect(goodSummary?.loadError).toBeUndefined();
    expect(goodSummary?.source).toBe("project");

    expect(badSummary).toBeDefined();
    expect(badSummary?.loadError).toBe("it broke");
    expect(badSummary?.source).toBe("installed");
    expect(badSummary?.toolNames).toEqual([]);

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

  it("removes grouped tools from TOOL_GROUPS on unload", async () => {
    const loader = new ModuleLoader({});
    await loader.load({
      name: "grouped-unload-mod",
      tools: [{ ...makeTool("grouped_unload_tool"), group: "test_unload_group" }],
    });

    expect(TOOL_GROUPS.test_unload_group).toContain("grouped_unload_tool");

    await loader.unload("grouped-unload-mod");
    expect(TOOL_GROUPS.test_unload_group).toBeUndefined();
  });

  it("removes grouped tools from TOOL_GROUPS on unloadAll", async () => {
    const loader = new ModuleLoader({});
    await loader.load({
      name: "grouped-unload-all-mod",
      tools: [{ ...makeTool("grouped_unload_all_tool"), group: "test_unload_all_group" }],
    });

    expect(TOOL_GROUPS.test_unload_all_group).toContain("grouped_unload_all_tool");

    await loader.unloadAll();
    expect(TOOL_GROUPS.test_unload_all_group).toBeUndefined();
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

  it("unload calls onUnload", async () => {
    const unloadCalled = vi.fn();
    const loader = new ModuleLoader({});

    await loader.load({
      name: "evt-mod",
      onUnload: unloadCalled,
    });

    await loader.unload("evt-mod");
    expect(unloadCalled).toHaveBeenCalledOnce();
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

  it("reload cleans up config keys, skills, workflows, and channels", async () => {
    const loader = new ModuleLoader({});
    await loader.load({
      name: "cleanup-mod",
      tools: [makeTool("cleanup_tool")],
      configKeys: [{ key: "cleanupMod" }],
    });

    expect(loader.getRegisteredConfigKeys().has("cleanupMod")).toBe(true);

    await loader.reload("cleanup-mod");

    expect(loader.getRegisteredConfigKeys().has("cleanupMod")).toBe(true);
    expect(loader.getLoadedModules()).toEqual(["cleanup-mod"]);
    const r = await executeTool("cleanup_tool", {});
    expect(r.content).toBe("result from cleanup_tool");
  });

  it("unload cleans up config keys", async () => {
    const loader = new ModuleLoader({});
    await loader.load({
      name: "cfgkey-mod",
      configKeys: [{ key: "cfgKeyMod" }],
    });
    expect(loader.getRegisteredConfigKeys().has("cfgKeyMod")).toBe(true);

    await loader.unload("cfgkey-mod");
    expect(loader.getRegisteredConfigKeys().has("cfgKeyMod")).toBe(false);
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

describe("source reimport", () => {
  let tmpDir: string;

  beforeEach(() => {
    clearCustomTools();
    clearCustomGroups();
    resetGroups();
    tmpDir = mkdtempSync(join(tmpdir(), "kota-reimport-"));
  });

  afterEach(() => {
    clearCustomTools();
    clearCustomGroups();
    resetGroups();
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
  });

  it("reimport picks up changed module source from disk", async () => {
    const modDir = join(tmpDir, ".kota", "modules", "test-mod");
    mkdirSync(modDir, { recursive: true });

    writeFileSync(
      join(modDir, "index.mjs"),
      `export default { name: "test-mod", version: "1.0.0", description: "v1" };`,
    );

    const url1 = pathToFileURL(join(modDir, "index.mjs")).href;
    const mod1 = await import(url1);
    expect(mod1.default.description).toBe("v1");

    writeFileSync(
      join(modDir, "index.mjs"),
      `export default { name: "test-mod", version: "2.0.0", description: "v2" };`,
    );

    const cachedMod = await import(url1);
    expect(cachedMod.default.description).toBe("v1");

    const cacheBustedUrl = `${url1}?v=${Date.now()}`;
    const mod2 = await import(cacheBustedUrl);
    expect(mod2.default.description).toBe("v2");
  });

  it("ModuleLoader.reload re-imports installed module from disk", async () => {
    const modDir = join(tmpDir, ".kota", "modules", "disk-mod");
    mkdirSync(modDir, { recursive: true });

    writeFileSync(
      join(modDir, "index.mjs"),
      `export default {
        name: "disk-mod",
        description: "original",
        tools: [{
          tool: { name: "disk_tool", description: "disk tool", input_schema: { type: "object", properties: {} } },
          runner: async () => ({ content: "v1" }),
          risk: "safe",
          kind: "discovery",
        }],
      };`,
    );

    const loader = new ModuleLoader({});
    loader.setCwd(tmpDir);

    const { reimportInstalledModule } = await import("./module-discovery.js");
    const mod = await reimportInstalledModule("disk-mod", tmpDir);
    expect(mod).not.toBeNull();

    await loader.loadAll([], [mod!]);

    const r1 = await executeTool("disk_tool", {});
    expect(r1.content).toBe("v1");

    writeFileSync(
      join(modDir, "index.mjs"),
      `export default {
        name: "disk-mod",
        description: "updated",
        tools: [{
          tool: { name: "disk_tool", description: "disk tool", input_schema: { type: "object", properties: {} } },
          runner: async () => ({ content: "v2" }),
          risk: "safe",
          kind: "discovery",
        }],
      };`,
    );

    const reloaded = await loader.reload("disk-mod");
    expect(reloaded).toBe(true);

    const r2 = await executeTool("disk_tool", {});
    expect(r2.content).toBe("v2");

    await loader.unloadAll();
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

describe("Module SDK — storage, config, skills", () => {
  let tmpDir: string;

  beforeEach(() => {
    clearCustomTools();
    clearCustomGroups();
    resetGroups();
    tmpDir = mkdtempSync(join(tmpdir(), "kota-test-"));
  });

  afterEach(() => {
    clearCustomTools();
    clearCustomGroups();
    resetGroups();
    rmSync(tmpDir, { recursive: true, force: true });
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

  it("collects skill content from modules", async () => {
    const skillPath = join(tmpDir, "helper.md");
    writeFileSync(skillPath, "Use the helper tool for quick lookups.");
    const loader = new ModuleLoader({}, false);
    loader.setCwd(tmpDir);
    await loader.load({
      name: "helper-mod",
      skills: [{ name: "helper", promptPath: "helper.md" }],
    });

    const prompt = loader.getSkillsPrompt();
    expect(prompt).toContain("## Module Capabilities");
    expect(prompt).toContain("### helper");
    expect(prompt).toContain("Use the helper tool for quick lookups.");
  });

  it("handles missing skill file gracefully", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const loader = new ModuleLoader({});
    await loader.load({
      name: "broken-mod",
      skills: [{ name: "missing", promptPath: "nonexistent/skill.md" }],
    });

    expect(loader.getSkillsPrompt()).toBe("");
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining('Module "broken-mod" skill "missing" failed to load'),
    );
    errSpy.mockRestore();
  });

  it("collects multiple skills in load order", async () => {
    const skillA = join(tmpDir, "skill-a.md");
    const skillB = join(tmpDir, "skill-b.md");
    writeFileSync(skillA, "Section A content.");
    writeFileSync(skillB, "Section B content.");
    const loader = new ModuleLoader({});
    loader.setCwd(tmpDir);
    await loader.load({
      name: "mod-a",
      skills: [{ name: "skill-a", promptPath: "skill-a.md" }],
    });
    await loader.load({
      name: "mod-b",
      skills: [{ name: "skill-b", promptPath: "skill-b.md" }],
    });

    const prompt = loader.getSkillsPrompt();
    const idxA = prompt.indexOf("### skill-a");
    const idxB = prompt.indexOf("### skill-b");
    expect(idxA).toBeLessThan(idxB);
    expect(prompt).toContain("Section A content.");
    expect(prompt).toContain("Section B content.");
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

  it("commandsOnly mode skips skill loading", async () => {
    const skillPath = join(tmpDir, "skill.md");
    writeFileSync(skillPath, "Should not appear.");
    const loader = new ModuleLoader({}, false, { commandsOnly: true });
    loader.setCwd(tmpDir);
    await loader.load({
      name: "skip-mod",
      skills: [{ name: "skill", promptPath: "skill.md" }],
    });

    expect(loader.getSkillsPrompt()).toBe("");
  });
});

describe("ctx.callTool — direct tool invocation", () => {
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

  it("invokes a registered tool and returns its result", async () => {
    const loader = new ModuleLoader({});
    await loader.load({
      name: "tool-provider",
      tools: [makeTool("helper_tool")],
    });

    let capturedCtx: any;
    await loader.load({
      name: "tool-caller",
      onLoad: (ctx) => { capturedCtx = ctx; },
    });

    const result = await capturedCtx.callTool("helper_tool", {});
    expect(result.content).toBe("result from helper_tool");
    expect(result.is_error).toBeFalsy();
  });

  it("returns error for unknown tool", async () => {
    const loader = new ModuleLoader({});
    let capturedCtx: any;
    await loader.load({
      name: "caller",
      onLoad: (ctx) => { capturedCtx = ctx; },
    });

    const result = await capturedCtx.callTool("nonexistent_tool", {});
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("Unknown tool");
  });

  it("returns error when tool runner throws", async () => {
    const loader = new ModuleLoader({});
    await loader.load({
      name: "throwing-mod",
      tools: [{
        tool: {
          name: "throws_tool",
          description: "Throws",
          input_schema: { type: "object" as const, properties: {} },
        },
        runner: async () => { throw new Error("boom"); },
        risk: "safe" as const, kind: "discovery" as const,
      }],
    });

    let capturedCtx: any;
    await loader.load({
      name: "caller",
      onLoad: (ctx) => { capturedCtx = ctx; },
    });

    const result = await capturedCtx.callTool("throws_tool", {});
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("boom");
  });

  it("enforces recursion depth limit", async () => {
    const loader = new ModuleLoader({});
    let capturedCtx: any;

    await loader.load({
      name: "recursive-mod",
      tools: (ctx) => {
        capturedCtx = ctx;
        return [{
          tool: {
            name: "recursive_tool",
            description: "Calls itself",
            input_schema: { type: "object" as const, properties: {} },
          },
          runner: async () => ctx.callTool("recursive_tool", {}),
          risk: "safe" as const, kind: "discovery" as const,
        }];
      },
    });

    const result = await capturedCtx.callTool("recursive_tool", {});
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("depth limit exceeded");
  });

  it("resets depth counter after successful call", async () => {
    const loader = new ModuleLoader({});
    await loader.load({
      name: "tool-mod",
      tools: [makeTool("simple_tool")],
    });

    let capturedCtx: any;
    await loader.load({
      name: "caller",
      onLoad: (ctx) => { capturedCtx = ctx; },
    });

    // Multiple sequential calls should all succeed (depth resets)
    const r1 = await capturedCtx.callTool("simple_tool", {});
    const r2 = await capturedCtx.callTool("simple_tool", {});
    const r3 = await capturedCtx.callTool("simple_tool", {});
    expect(r1.content).toBe("result from simple_tool");
    expect(r2.content).toBe("result from simple_tool");
    expect(r3.content).toBe("result from simple_tool");
  });

  it("passes input to the tool runner", async () => {
    const loader = new ModuleLoader({});
    await loader.load({
      name: "echo-mod",
      tools: [{
        tool: {
          name: "echo_tool",
          description: "Echoes input",
          input_schema: { type: "object" as const, properties: { msg: { type: "string" } } },
        },
        runner: async (input: Record<string, unknown>) => ({ content: `echo: ${input.msg}` }),
        risk: "safe" as const, kind: "discovery" as const,
      }],
    });

    let capturedCtx: any;
    await loader.load({
      name: "caller",
      onLoad: (ctx) => { capturedCtx = ctx; },
    });

    const result = await capturedCtx.callTool("echo_tool", { msg: "hello" });
    expect(result.content).toBe("echo: hello");
  });

  it("allows chained tool calls within depth limit", async () => {
    const loader = new ModuleLoader({});

    // Tool A calls Tool B, which returns a result
    await loader.load({
      name: "chain-mod",
      tools: (ctx) => [
        {
          tool: {
            name: "tool_b",
            description: "Leaf tool",
            input_schema: { type: "object" as const, properties: {} },
          },
          runner: async () => ({ content: "leaf result" }),
          risk: "safe" as const, kind: "discovery" as const,
        },
        {
          tool: {
            name: "tool_a",
            description: "Calls tool_b",
            input_schema: { type: "object" as const, properties: {} },
          },
          runner: async () => {
            const inner = await ctx.callTool("tool_b", {});
            return { content: `chained: ${inner.content}` };
          },
          risk: "safe" as const, kind: "discovery" as const,
        },
      ],
    });

    let capturedCtx: any;
    await loader.load({
      name: "caller",
      onLoad: (c) => { capturedCtx = c; },
    });

    const result = await capturedCtx.callTool("tool_a", {});
    expect(result.content).toBe("chained: leaf result");
  });

  it("callTool works from event handlers via captured context", async () => {
    const bus = new EventBus();
    const loader = new ModuleLoader({});
    let eventResult: any;

    await loader.load({
      name: "tool-mod",
      tools: [makeTool("event_target")],
    });

    await loader.load({
      name: "event-caller",
      tools: (ctx) => {
        // Event handler captures ctx and uses callTool
        bus.on("test.trigger", async () => {
          eventResult = await ctx.callTool("event_target", {});
        });
        return [];
      },
    });

    bus.emit("test.trigger", {});
    // Wait for async handler
    await new Promise((r) => setTimeout(r, 10));
    expect(eventResult?.content).toBe("result from event_target");
  });

  it("probeHealthChecks collects results from modules with healthCheck", async () => {
    const loader = new ModuleLoader({});
    await loader.load({
      name: "healthy-mod",
      healthCheck: () => ({ status: "healthy" }),
    });
    await loader.load({
      name: "degraded-mod",
      healthCheck: async () => ({ status: "degraded", message: "token expiring" }),
    });
    await loader.load({ name: "no-check-mod" });

    const results = await loader.probeHealthChecks();
    expect(results["healthy-mod"]).toEqual({ status: "healthy" });
    expect(results["degraded-mod"]).toEqual({ status: "degraded", message: "token expiring" });
    expect(results["no-check-mod"]).toBeUndefined();
  });

  it("probeHealthChecks catches thrown errors as unhealthy", async () => {
    const loader = new ModuleLoader({});
    await loader.load({
      name: "broken-mod",
      healthCheck: () => { throw new Error("boom"); },
    });

    const results = await loader.probeHealthChecks();
    expect(results["broken-mod"].status).toBe("unhealthy");
    expect(results["broken-mod"].message).toContain("boom");
  });

  it("collects configKeys from loaded modules", async () => {
    const loader = new ModuleLoader({});
    await loader.load({
      name: "mod-a",
      configKeys: [{ key: "myKey", description: "test key" }],
    });
    await loader.load({
      name: "mod-b",
      configKeys: [{ key: "otherKey" }],
    });
    const keys = loader.getRegisteredConfigKeys();
    expect(keys.has("myKey")).toBe(true);
    expect(keys.has("otherKey")).toBe(true);
    expect(keys.size).toBe(2);
  });

  it("rejects duplicate configKeys across modules", async () => {
    const loader = new ModuleLoader({});
    await loader.load({
      name: "mod-a",
      configKeys: [{ key: "shared" }],
    });
    await expect(
      loader.load({
        name: "mod-b",
        configKeys: [{ key: "shared" }],
      }),
    ).rejects.toThrow(/already claimed by "mod-a"/);
  });

  it("returns empty set when no modules declare configKeys", async () => {
    const loader = new ModuleLoader({});
    await loader.load({ name: "plain" });
    expect(loader.getRegisteredConfigKeys().size).toBe(0);
  });
});
