import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearCustomTools, executeTool, getAllTools } from "#core/tools/index.js";
import { clearCustomGroups, enableGroup, filterTools, resetGroups, TOOL_GROUPS } from "#core/tools/tool-groups.js";
import { createRuntimeModuleLoader } from "./module-context.test-helpers.js";
import { discoverModules as discoverMachineAuthorizedModules } from "./module-discovery.js";
import type { ModuleLoader } from "./module-loader.js";

function makeTmpDir(): string {
  const dir = join(tmpdir(), `kota-module-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Write a single-file code module to .kota/modules/<name>/index.mjs */
function writeModule(dir: string, name: string, code: string): void {
  const moduleDir = join(dir, ".kota", "modules", name);
  mkdirSync(moduleDir, { recursive: true });
  writeFileSync(join(moduleDir, "index.mjs"), code);
}

describe("discoverModules", () => {
  let tmpDir: string;
  let globalConfigPath: string;
  let loader: ModuleLoader;
  const discoverModules = (cwd?: string, verbose = false) =>
    discoverMachineAuthorizedModules(cwd, verbose, { globalConfigPath });

  beforeEach(() => {
    tmpDir = makeTmpDir();
    globalConfigPath = join(tmpDir, "machine-config.json");
    writeFileSync(globalConfigPath, JSON.stringify({ trustedProjects: [tmpDir] }));
    clearCustomTools();
    clearCustomGroups();
    resetGroups();
    loader = createRuntimeModuleLoader({}, false, { globalConfigPath });
  });

  afterEach(async () => {
    await loader.unloadAll();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("discovers nothing when .kota/modules/ does not exist", async () => {
    const modules = await discoverModules(tmpDir);
    expect(modules).toEqual([]);
  });

  it("does not import project code until persisted machine authority trusts it", async () => {
    const importMarker = join(tmpDir, "module-imported.flag");
    writeModule(tmpDir, "authority-bypass", `
      import { writeFileSync } from "node:fs";
      writeFileSync(${JSON.stringify(importMarker)}, "imported");
      export default { name: "authority-bypass" };
    `);
    writeFileSync(
      join(tmpDir, ".kota", "config.json"),
      JSON.stringify({ trustedProjects: [tmpDir] }),
    );
    writeFileSync(globalConfigPath, "{}\n");

    expect(await discoverModules(tmpDir)).toEqual([]);
    expect(existsSync(importMarker)).toBe(false);

    writeFileSync(globalConfigPath, JSON.stringify({ trustedProjects: [tmpDir] }));
    expect(await discoverModules(tmpDir)).toHaveLength(1);
    expect(existsSync(importMarker)).toBe(true);
  });

  it("discovers and loads a simple module with one tool", async () => {
    writeModule(tmpDir, "hello", `
      export default {
        name: "hello-module",
        tools: [{
          tool: {
            name: "hello_world",
            description: "Says hello",
            input_schema: { type: "object", properties: {} },
          },
          runner: async () => ({ content: "Hello from module!" }),
          effect: { kind: "read", scope: "local-fs", idempotent: true, openWorld: false },
        }],
      };
    `);

    const modules = await discoverModules(tmpDir);
    expect(modules).toHaveLength(1);
    expect(modules[0].name).toBe("hello-module");

    await loader.loadAll(modules);
    expect(loader.getModuleCount()).toBe(1);
    expect(loader.getToolCount()).toBe(1);

    const result = await executeTool("hello_world", {});
    expect(result.content).toBe("Hello from module!");
  });

  it("registers tool into a group when group is specified", async () => {
    writeModule(tmpDir, "grouped", `
      export default {
        name: "grouped-module",
        tools: [{
          tool: {
            name: "custom_analyzer",
            description: "Analyze something",
            input_schema: { type: "object", properties: {} },
          },
          runner: async () => ({ content: "analyzed" }),
          effect: { kind: "read", scope: "local-fs", idempotent: true, openWorld: false },
          group: "analysis",
        }],
      };
    `);

    const modules = await discoverModules(tmpDir);
    await loader.loadAll(modules);

    expect(TOOL_GROUPS.analysis).toEqual(["custom_analyzer"]);

    // Tool should NOT appear in filtered tools until group is enabled
    const beforeEnable = filterTools(getAllTools());
    expect(beforeEnable.some((t) => t.name === "custom_analyzer")).toBe(false);

    enableGroup("analysis");
    const afterEnable = filterTools(getAllTools());
    expect(afterEnable.some((t) => t.name === "custom_analyzer")).toBe(true);
  });

  it("ungrouped module tools are always available", async () => {
    writeModule(tmpDir, "always", `
      export default {
        name: "always-module",
        tools: [{
          tool: {
            name: "always_available",
            description: "Always here",
            input_schema: { type: "object", properties: {} },
          },
          runner: async () => ({ content: "always" }),
          effect: { kind: "read", scope: "local-fs", idempotent: true, openWorld: false },
        }],
      };
    `);

    const modules = await discoverModules(tmpDir);
    await loader.loadAll(modules);

    const filtered = filterTools(getAllTools());
    expect(filtered.some((t) => t.name === "always_available")).toBe(true);
  });

  it("calls onLoad with ModuleContext", async () => {
    writeModule(tmpDir, "lifecycle", `
      let loaded = false;
      export default {
        name: "lifecycle-module",
        onLoad: (ctx) => {
          loaded = true;
          if (!ctx.cwd || typeof ctx.verbose !== "boolean" || typeof ctx.registerGroup !== "function") {
            throw new Error("Invalid ModuleContext");
          }
        },
        tools: [{
          tool: {
            name: "check_loaded",
            description: "Check if onLoad ran",
            input_schema: { type: "object", properties: {} },
          },
          runner: async () => ({ content: loaded ? "yes" : "no" }),
          effect: { kind: "read", scope: "local-fs", idempotent: true, openWorld: false },
        }],
      };
    `);

    const modules = await discoverModules(tmpDir);
    await loader.loadAll(modules);
    const result = await executeTool("check_loaded", {});
    expect(result.content).toBe("yes");
  });

  it("calls onUnload during unloadAll", async () => {
    const flagPath = join(tmpDir, "unloaded.flag");
    writeModule(tmpDir, "unload", `
      import { writeFileSync } from "node:fs";
      export default {
        name: "unload-module",
        onUnload: () => {
          writeFileSync(${JSON.stringify(flagPath)}, "unloaded");
        },
      };
    `);

    const modules = await discoverModules(tmpDir);
    await loader.loadAll(modules);
    expect(loader.getModuleCount()).toBe(1);

    await loader.unloadAll();
    expect(loader.getModuleCount()).toBe(0);

    const { existsSync } = await import("node:fs");
    expect(existsSync(flagPath)).toBe(true);
  });

  it("skips modules without a name", async () => {
    writeModule(tmpDir, "bad", `
      export default { tools: [] };
    `);

    const modules = await discoverModules(tmpDir);
    // adaptExport logs an error and the module is skipped
    expect(modules).toHaveLength(0);
  });

  it("rejects duplicate module names via ModuleLoader", async () => {
    writeModule(tmpDir, "a", `export default { name: "dupe" };`);
    writeModule(tmpDir, "b", `export default { name: "dupe" };`);

    const modules = await discoverModules(tmpDir);
    expect(modules).toHaveLength(2);

    // ModuleLoader rejects the duplicate — first loads, second errors silently
    await loader.loadAll([], modules);
    expect(loader.getModuleCount()).toBe(1);
  });

  it("discovers modules in alphabetical directory order", async () => {
    writeModule(tmpDir, "z-last", `export default { name: "z-last" };`);
    writeModule(tmpDir, "a-first", `export default { name: "a-first" };`);
    writeModule(tmpDir, "m-middle", `export default { name: "m-middle" };`);

    const modules = await discoverModules(tmpDir);
    expect(modules.map((m) => m.name)).toEqual(["a-first", "m-middle", "z-last"]);
  });

  it("ignores directories with no recognized module format", async () => {
    const moduleDir = join(tmpDir, ".kota", "modules", "unknown");
    mkdirSync(moduleDir, { recursive: true });
    writeFileSync(join(moduleDir, "readme.md"), "# Not a module");
    writeFileSync(join(moduleDir, "data.json"), "{}");
    writeModule(tmpDir, "real", `export default { name: "real" };`);

    const modules = await discoverModules(tmpDir);
    expect(modules).toHaveLength(1);
    expect(modules[0].name).toBe("real");
  });

  it("cleans up tools on ModuleLoader.unloadAll", async () => {
    writeModule(tmpDir, "cleanup", `
      export default {
        name: "cleanup-module",
        tools: [{
          tool: {
            name: "temp_tool",
            description: "Temporary",
            input_schema: { type: "object", properties: {} },
          },
          runner: async () => ({ content: "temp" }),
          effect: { kind: "read", scope: "local-fs", idempotent: true, openWorld: false },
          group: "temp_group",
        }],
      };
    `);

    const modules = await discoverModules(tmpDir);
    await loader.loadAll(modules);

    expect(TOOL_GROUPS.temp_group).toEqual(["temp_tool"]);
    const result = await executeTool("temp_tool", {});
    expect(result.content).toBe("temp");

    await loader.unloadAll();

    // Tool should be gone
    const result2 = await executeTool("temp_tool", {});
    expect(result2.is_error).toBe(true);
  });

});
