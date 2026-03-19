/**
 * End-to-end integration test: module loading → CLI command registration → tool availability.
 *
 * Tests the seams between ModuleLoader, cli.ts, and the agent loop to ensure
 * modules correctly register their tools, CLI commands, and HTTP routes through
 * the full pipeline — not just in isolation.
 */

import { execFileSync, type SpawnSyncReturns } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ModuleLoader } from "./module-loader.js";
import type { KotaModule } from "./module-types.js";
import { builtinModules } from "./modules/index.js";
import { clearCustomGroups, enableGroup, filterTools, resetGroups, } from "./tool-groups.js";
import { clearCustomTools, executeTool, getAllTools } from "./tools/index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = resolve(root, "dist/cli.js");

function runCli(...args: string[]): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execFileSync("node", [CLI, ...args], {
      encoding: "utf-8",
      timeout: 5000,
      cwd: root,
    });
    return { stdout, stderr: "", exitCode: 0 };
  } catch (err) {
    const e = err as SpawnSyncReturns<string>;
    return {
      stdout: e.stdout || "",
      stderr: e.stderr || "",
      exitCode: e.status ?? 1,
    };
  }
}

describe("module → CLI pipeline (full lifecycle)", () => {
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

  it("ModuleLoader.loadAll registers tools from all tool-providing modules", async () => {
    const loader = new ModuleLoader({});
    await loader.loadAll(builtinModules);

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

  it("ModuleLoader.loadAll registers all builtin modules", async () => {
    const loader = new ModuleLoader({});
    await loader.loadAll(builtinModules);

    const names = loader.getLoadedModules();
    expect(names).toHaveLength(15);
    expect(names).toContain("tool-cache");
    expect(names).toContain("working-memory");
    expect(names).toContain("memory");
    expect(names).toContain("knowledge");
    expect(names).toContain("history");
    expect(names).toContain("scheduler");
    expect(names).toContain("telegram");
    expect(names).toContain("daemon");
    expect(names).toContain("mcp-server");
    expect(names).toContain("vercel-adapter");
    expect(names).toContain("web");
    expect(names).toContain("registry");

    await loader.unloadAll();
  });

  it("commandsOnly loader produces same commands as full loader (no tool side-effects)", async () => {
    // Full loader registers tools
    const fullLoader = new ModuleLoader({});
    await fullLoader.loadAll(builtinModules);
    const fullCommands = fullLoader.getCommands().map((c) => c.name()).sort();

    await fullLoader.unloadAll();

    // commandsOnly loader should produce the same commands without registering tools
    const cliLoader = new ModuleLoader({}, false, { commandsOnly: true });
    await cliLoader.loadAll(builtinModules);
    const cliCommands = cliLoader.getCommands().map((c) => c.name()).sort();

    expect(cliCommands).toEqual(fullCommands);
    expect(cliCommands.length).toBeGreaterThanOrEqual(4);

    // commandsOnly should NOT register tools (tool count stays at 0 in custom set)
    expect(cliLoader.getToolCount()).toBe(0);

    await cliLoader.unloadAll();
  });

  it("module tools appear in tool registry when groups are enabled", async () => {
    const loader = new ModuleLoader({});
    await loader.loadAll(builtinModules);

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
    const loader = new ModuleLoader({});
    await loader.loadAll(builtinModules);

    expect(loader.getModuleCount()).toBe(15);
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
    const loader = new ModuleLoader({});
    await loader.loadAll(builtinModules);

    const routes = loader.getRoutes();
    // vercel-adapter provides POST /api/chat/vercel
    expect(routes.some((r) => r.path === "/api/chat/vercel" && r.method === "POST")).toBe(true);

    await loader.unloadAll();
  });
});

describe("module error resilience", () => {
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

  it("broken module in loadAll does not prevent other modules from loading", async () => {
    const loader = new ModuleLoader({});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const brokenModule: KotaModule = {
      name: "broken",
      onLoad: () => { throw new Error("Module init explosion"); },
    };

    // Load broken module alongside real modules
    await loader.loadAll([brokenModule, ...builtinModules]);

    // Broken module should not be loaded
    expect(loader.getLoadedModules()).not.toContain("broken");
    // But all builtin modules should still load
    expect(loader.getLoadedModules()).toContain("memory");
    expect(loader.getLoadedModules()).toContain("scheduler");
    expect(loader.getModuleCount()).toBe(15);

    errSpy.mockRestore();
    await loader.unloadAll();
  });

  it("broken module commands() does not prevent other module commands", async () => {
    const loader = new ModuleLoader({});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const brokenCommandModule: KotaModule = {
      name: "broken-cmd",
      commands: () => { throw new Error("Command factory explosion"); },
    };

    // Load the broken module alongside real ones
    await loader.loadAll([brokenCommandModule, ...builtinModules]);

    // getCommands should gracefully skip the broken module
    const commands = loader.getCommands();
    const commandNames = commands.map((c) => c.name());

    // Real module commands should still be available
    expect(commandNames).toContain("serve");
    expect(commandNames).toContain("telegram");
    expect(commandNames).toContain("daemon");
    expect(commandNames).toContain("tools");

    // Error should have been logged
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining('Module "broken-cmd" command registration failed'),
    );

    errSpy.mockRestore();
    await loader.unloadAll();
  });

  it("broken module routes() does not prevent other module routes", async () => {
    const loader = new ModuleLoader({});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const brokenRouteModule: KotaModule = {
      name: "broken-route",
      routes: () => { throw new Error("Route factory explosion"); },
    };

    await loader.loadAll([brokenRouteModule, ...builtinModules]);

    const routes = loader.getRoutes();
    // vercel-adapter routes should still work
    expect(routes.some((r) => r.path === "/api/chat/vercel")).toBe(true);

    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining('Module "broken-route" route registration failed'),
    );

    errSpy.mockRestore();
    await loader.unloadAll();
  });
});

describe("CLI module commands (compiled binary)", () => {
  it("--help lists all module-provided commands", () => {
    const { stdout } = runCli("--help");
    // Commands from modules
    expect(stdout).toContain("serve");
    expect(stdout).toContain("telegram");
    expect(stdout).toContain("daemon");
    expect(stdout).toContain("tools");
    // Built-in commands
    expect(stdout).toContain("run");
    expect(stdout).toContain("history");
  });

  it("module commands have working --help", () => {
    const commands = ["serve", "telegram", "daemon"];
    for (const cmd of commands) {
      const { stdout, exitCode } = runCli(cmd, "--help");
      expect(exitCode).toBe(0);
      expect(stdout).toContain("--model");
      expect(stdout).toContain("--verbose");
    }
  });

  it("tools subcommand from registry module works", () => {
    const { stdout, exitCode } = runCli("tools", "list");
    expect(exitCode).toBe(0);
    // Output should be either "No tools installed" or a table
    expect(stdout.length).toBeGreaterThan(0);
  });
});

describe("module lifecycle across multiple loadAll/unloadAll cycles", () => {
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

  it("can load, unload, and reload modules cleanly", async () => {
    const loader = new ModuleLoader({});

    // First cycle
    await loader.loadAll(builtinModules);
    expect(loader.getModuleCount()).toBe(15);
    const memResult1 = await executeTool("memory", { action: "list" });
    expect(memResult1.is_error).toBeFalsy();

    await loader.unloadAll();
    expect(loader.getModuleCount()).toBe(0);

    // Second cycle — should work identically
    const loader2 = new ModuleLoader({});
    await loader2.loadAll(builtinModules);
    expect(loader2.getModuleCount()).toBe(15);
    const memResult2 = await executeTool("memory", { action: "list" });
    expect(memResult2.is_error).toBeFalsy();

    await loader2.unloadAll();
  });

  it("two loaders cannot register the same module tools simultaneously", async () => {
    const loader1 = new ModuleLoader({});
    await loader1.loadAll(builtinModules);

    // Second loader should fail on duplicate tools
    const loader2 = new ModuleLoader({});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await loader2.loadAll(builtinModules);

    // Tool-providing modules (memory, scheduler) should have failed
    // because their tools are already registered
    const loaded = loader2.getLoadedModules();
    expect(loaded).not.toContain("memory");
    expect(loaded).not.toContain("scheduler");

    // Modules without tools should still load
    expect(loaded).toContain("telegram");
    expect(loaded).toContain("daemon");

    errSpy.mockRestore();
    await loader1.unloadAll();
    await loader2.unloadAll();
  });
});
