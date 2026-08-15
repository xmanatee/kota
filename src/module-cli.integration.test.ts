/**
 * End-to-end integration test: module loading → CLI command registration → tool availability.
 *
 * Tests the seams between ModuleLoader, cli.ts, and the agent loop to ensure
 * modules correctly register their tools, CLI commands, and HTTP routes through
 * the full pipeline — not just in isolation.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "./core/events/event-bus.js";
import { ModuleLoader } from "./core/modules/module-loader.js";
import type { KotaModule } from "./core/modules/module-types.js";
import { discoverProjectModules } from "./core/modules/project-discovery.js";
import { clearCustomTools, executeTool, getAllTools } from "./core/tools/index.js";
import { clearCustomGroups, enableGroup, filterTools, resetGroups, } from "./core/tools/tool-groups.js";

let projectModules: KotaModule[];

function createRuntimeLoader(): ModuleLoader {
  const loader = new ModuleLoader({});
  loader.setBus(new EventBus());
  return loader;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("module → CLI pipeline (full lifecycle)", () => {
  beforeEach(async () => {
    projectModules = await discoverProjectModules();
    clearCustomTools();
    clearCustomGroups();
    resetGroups();
  });

  afterEach(() => {
    clearCustomTools();
    clearCustomGroups();
    resetGroups();
  });

  it("ModuleLoader.loadAll registers tools from all tool-providing modules", async () => {
    const loader = createRuntimeLoader();
    await loader.loadAll(projectModules);

    // Memory and scheduler modules provide tools
    const moduleNames = loader.getLoadedModules();
    expect(moduleNames).toContain("memory");
    expect(moduleNames).toContain("scheduler");
    expect(loader.getToolCount()).toBeGreaterThanOrEqual(2);

    // Tools should be callable
    const memResult = await executeTool("memory", { action: "list" });
    expect(memResult.is_error).toBeFalsy();

    const schedResult = await executeTool("schedule", { action: "list" });
    expect(schedResult.is_error).toBeFalsy();

    await loader.unloadAll();
  });

  it("ModuleLoader.loadAll registers all project modules", async () => {
    const loader = createRuntimeLoader();
    await loader.loadAll(projectModules);

    const names = loader.getLoadedModules();
    expect(names).toHaveLength(projectModules.length);
    expect(names).toContain("tool-cache");
    expect(names).toContain("working-memory");
    expect(names).toContain("memory");
    expect(names).toContain("knowledge");
    expect(names).toContain("history");
    expect(names).toContain("scheduler");
    expect(names).toContain("telegram");
    expect(names).toContain("daemon-ops");
    expect(names).toContain("mcp-server");
    expect(names).toContain("vercel-adapter");
    expect(names).toContain("web");
    expect(names).toContain("registry");

    await loader.unloadAll();
  });

  it("\"commands\" mode loader produces same commands as runtime loader (no tool side-effects)", async () => {
    // Runtime loader registers tools
    const fullLoader = createRuntimeLoader();
    await fullLoader.loadAll(projectModules);
    const fullCommands = fullLoader.getCommands().map((c) => c.name()).sort();

    await fullLoader.unloadAll();

    // Commands-mode loader should produce the same commands without registering tools
    const cliLoader = new ModuleLoader({}, false, { mode: "commands" });
    await cliLoader.loadAll(projectModules);
    const cliCommands = cliLoader.getCommands().map((c) => c.name()).sort();

    expect(cliCommands).toEqual(fullCommands);
    expect(cliCommands.length).toBeGreaterThanOrEqual(4);

    // Commands mode should NOT register tools (tool count stays at 0 in custom set)
    expect(cliLoader.getMode()).toBe("commands");
    expect(cliLoader.getToolCount()).toBe(0);

    await cliLoader.unloadAll();
  });

  it("module tools appear in tool registry when groups are enabled", async () => {
    const loader = createRuntimeLoader();
    await loader.loadAll(projectModules);

    // Before enabling groups, module tools should be hidden
    const beforeTools = filterTools(getAllTools());
    const moduleToolNames = ["memory", "schedule"];
    for (const name of moduleToolNames) {
      expect(beforeTools.some((t) => t.name === name)).toBe(false);
    }

    // After enabling management group, module tools should be visible
    enableGroup("management");
    const afterTools = filterTools(getAllTools());
    for (const name of moduleToolNames) {
      expect(afterTools.some((t) => t.name === name)).toBe(true);
    }

    await loader.unloadAll();
  });

  it("unloadAll clears module tools and resets state", async () => {
    const loader = createRuntimeLoader();
    await loader.loadAll(projectModules);

    expect(loader.getModuleCount()).toBe(projectModules.length);
    expect(loader.getToolCount()).toBeGreaterThanOrEqual(2);

    await loader.unloadAll();

    expect(loader.getModuleCount()).toBe(0);
    expect(loader.getToolCount()).toBe(0);
    expect(loader.getLoadedModules()).toEqual([]);

    // Module tools should no longer be callable
    const memResult = await executeTool("memory", { action: "list" });
    expect(memResult.is_error).toBe(true);
    expect(memResult.content).toContain("Unknown tool");
  });

  it("getRoutes collects HTTP routes from route-providing modules", async () => {
    const loader = createRuntimeLoader();
    await loader.loadAll(projectModules);

    const routes = loader.getRoutes();
    // vercel-adapter provides POST /api/chat/vercel
    expect(routes.some((r) => r.path === "/api/chat/vercel" && r.method === "POST")).toBe(true);

    await loader.unloadAll();
  });
});

describe("module lifecycle across multiple loadAll/unloadAll cycles", () => {
  beforeEach(async () => {
    projectModules = await discoverProjectModules();
    clearCustomTools();
    clearCustomGroups();
    resetGroups();
  });

  afterEach(() => {
    clearCustomTools();
    clearCustomGroups();
    resetGroups();
  });

  it("can load, unload, and reload modules cleanly", async () => {
    const loader = createRuntimeLoader();

    // First cycle
    await loader.loadAll(projectModules);
    expect(loader.getModuleCount()).toBe(projectModules.length);
    const memResult1 = await executeTool("memory", { action: "list" });
    expect(memResult1.is_error).toBeFalsy();

    await loader.unloadAll();
    expect(loader.getModuleCount()).toBe(0);

    // Second cycle — should work identically
    const loader2 = createRuntimeLoader();
    await loader2.loadAll(projectModules);
    expect(loader2.getModuleCount()).toBe(projectModules.length);
    const memResult2 = await executeTool("memory", { action: "list" });
    expect(memResult2.is_error).toBeFalsy();

    await loader2.unloadAll();
  });

  it("two loaders cannot register the same module tools simultaneously", async () => {
    const loader1 = createRuntimeLoader();
    await loader1.loadAll(projectModules);

    // Second loader should fail on duplicate tools — project module failures throw
    const loader2 = createRuntimeLoader();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(loader2.loadAll(projectModules)).rejects.toThrow("project module(s) failed to load");

    // Tool-providing modules (memory, scheduler, git) should have failed
    // because their tools are already registered
    const loaded = loader2.getLoadedModules();
    expect(loaded).not.toContain("memory");
    expect(loaded).not.toContain("scheduler");
    expect(loaded).not.toContain("git");

    // Modules without tools and without tool-conflicting transitive
    // dependencies should still load (repo-tasks -> rendering is a
    // tool-less subgraph). Modules like daemon-ops and telegram declare a
    // dependency on a tool-providing module (git / knowledge) and therefore
    // fail by transitive dependency, not by direct tool conflict.
    expect(loaded).toContain("repo-tasks");
    expect(loaded).toContain("rendering");
    expect(loaded).not.toContain("daemon-ops");

    errSpy.mockRestore();
    await loader1.unloadAll();
    await loader2.unloadAll();
  });
});
