import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearRegisteredConfigSlices,
  getRegisteredConfigSlice,
} from "#core/config/config-slice.js";
import { loadManifest, saveManifest } from "#core/manifest/persistence.js";
import { clearCustomTools, executeTool, getAllTools } from "#core/tools/index.js";
import { clearCustomGroups, enableGroup, filterTools, resetGroups, TOOL_GROUPS } from "#core/tools/tool-groups.js";
import { createRuntimeModuleLoader } from "./module-context.test-helpers.js";
import { discoverModules as discoverMachineAuthorizedModules, reimportInstalledModule } from "./module-discovery.js";
import type { ModuleLoader } from "./module-loader.js";
import { ModuleLogStore } from "./module-log.js";
import { ModuleStorage } from "./module-storage.js";
import { parseSource } from "./registry-source.js";

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
    writeFileSync(globalConfigPath, JSON.stringify({ trustedScopes: [tmpDir] }));
    clearCustomTools();
    clearCustomGroups();
    resetGroups();
    clearRegisteredConfigSlices();
    loader = createRuntimeModuleLoader({}, false, { globalConfigPath });
  });

  afterEach(async () => {
    await loader.unloadAll();
    clearRegisteredConfigSlices();
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
      JSON.stringify({ trustedScopes: [tmpDir] }),
    );
    writeFileSync(globalConfigPath, "{}\n");

    expect(await discoverModules(tmpDir)).toEqual([]);
    expect(existsSync(importMarker)).toBe(false);

    writeFileSync(globalConfigPath, JSON.stringify({ trustedScopes: [tmpDir] }));
    expect(await discoverModules(tmpDir)).toHaveLength(1);
    expect(existsSync(importMarker)).toBe(true);
  });

  it("converts saved tools only in trusted scopes and leaves activation to the loader", async () => {
    const tool = { name: "saved_probe", description: "Saved code", code: "print('ok')", language: "python" };
    const directory = join(tmpDir, ".kota", "tools");
    const source = join(directory, "saved_probe.json");
    mkdirSync(directory, { recursive: true });
    writeFileSync(source, JSON.stringify(tool));
    writeFileSync(globalConfigPath, "{}");
    expect(await discoverModules(tmpDir)).toEqual([]);
    expect(existsSync(source)).toBe(true);
    expect(existsSync(join(tmpDir, ".kota", "modules"))).toBe(false);

    writeFileSync(globalConfigPath, JSON.stringify({ trustedScopes: [tmpDir] }));
    const modules = await discoverModules(tmpDir);
    expect(modules.map((mod) => mod.name)).toEqual([tool.name]);
    expect(loadManifest(tool.name, tmpDir)).toEqual({ name: tool.name, tools: [tool] });
    expect(existsSync(source)).toBe(false);
    expect(getAllTools().some((item) => item.name === tool.name)).toBe(false);
    expect(await discoverModules(join(tmpDir, "other-scope"))).toEqual([]);
    expect((await discoverModules(tmpDir)).map((mod) => mod.name)).toEqual([tool.name]);
    await loader.loadAll(modules);
    expect(getAllTools().some((item) => item.name === tool.name)).toBe(true);
    await loader.unloadAll();
    expect(getAllTools().some((item) => item.name === tool.name)).toBe(false);
  });

  it("preserves conflicting or invalid saved definitions and resumes an interrupted conversion", async () => {
    const tool = { name: "saved_probe", description: "Saved code", code: "print('ok')" };
    const directory = join(tmpDir, ".kota", "tools");
    const source = join(directory, "saved_probe.json");
    mkdirSync(directory, { recursive: true });
    writeFileSync(source, JSON.stringify(tool));
    const conflicting = { name: tool.name, tools: [{ ...tool, code: "print('different')" }] };
    saveManifest(conflicting, tmpDir);
    await expect(discoverModules(tmpDir)).rejects.toThrow("already exists");
    expect(JSON.parse(readFileSync(source, "utf8"))).toEqual(tool);
    expect(loadManifest(tool.name, tmpDir)).toEqual(conflicting);

    saveManifest({ name: tool.name, tools: [tool] }, tmpDir);
    writeFileSync(source, JSON.stringify({ ...tool, code: 42 }));
    await expect(discoverModules(tmpDir)).rejects.toThrow("tool code is required");
    expect(existsSync(source)).toBe(true);
    writeFileSync(source, JSON.stringify(tool));
    expect(await discoverModules(tmpDir)).toHaveLength(1);
    expect(existsSync(source)).toBe(false);
  });

  it.each([".kota/tools", ".kota/tools/saved_probe.json", ".kota/modules/saved_probe"])(
    "rejects linked migration storage at %s without deleting the source or outside data", async (relativePath) => {
      const tool = { name: "saved_probe", description: "Saved code", code: "print('ok')" };
      const outside = join(tmpDir, "outside");
      mkdirSync(outside);
      const content = JSON.stringify(tool);
      writeFileSync(join(outside, "saved_probe.json"), content);
      const manifestContent = JSON.stringify({ name: tool.name, tools: [tool] });
      writeFileSync(join(outside, "manifest.json"), manifestContent);
      const link = join(tmpDir, relativePath);
      mkdirSync(join(link, ".."), { recursive: true });
      symlinkSync(relativePath.endsWith(".json") ? join(outside, "saved_probe.json") : outside, link);
      const source = join(tmpDir, ".kota/tools/saved_probe.json");
      if (relativePath.startsWith(".kota/modules")) {
        mkdirSync(join(source, ".."), { recursive: true });
        writeFileSync(source, content);
      }
      await expect(discoverModules(tmpDir)).rejects.toThrow("Unsafe filesystem path");
      expect(readFileSync(source, "utf8")).toBe(content);
      expect(readFileSync(join(outside, "manifest.json"), "utf8")).toBe(manifestContent);
    },
  );

  it("reports a dangling storage ancestor instead of treating it as absent", async () => {
    symlinkSync(join(tmpDir, "missing"), join(tmpDir, ".kota"));
    await expect(discoverModules(tmpDir)).rejects.toThrow("Unsafe filesystem path");
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

  it.each([
    ["github:owner/kota-audit.probe", "index.mjs"],
    ["npm:@owner/kota-audit.probe", "entry.mjs"],
  ])("discovers and reloads existing installer identities without renaming data: %s", async (source, entry) => {
    const { name } = parseSource(source);
    const directory = join(tmpDir, ".kota", "modules", name);
    mkdirSync(directory, { recursive: true });
    const code = `export default { name: ${JSON.stringify(name)}, description: "original" };`;
    writeFileSync(join(directory, entry), code);
    if (entry !== "index.mjs") {
      writeFileSync(join(directory, "package.json"), JSON.stringify({ main: entry }));
    }
    writeFileSync(join(directory, "state.json"), '{"retained":true}');
    writeModule(tmpDir, "neighbor", 'export default { name: "neighbor" };');

    expect((await discoverModules(tmpDir)).map(module => module.name)).toEqual([name, "neighbor"]);
    const storage = new ModuleStorage(tmpDir, name);
    expect(storage.getJSON("state")).toEqual({ retained: true });
    const distinct = new ModuleStorage(tmpDir, name.replace(".", "_"));
    distinct.setJSON("state", { separate: true });
    expect(storage.getJSON("state")).toEqual({ retained: true });
    expect(distinct.getJSON("state")).toEqual({ separate: true });

    const logs = new ModuleLogStore(tmpDir);
    logs.append(name, "info", "loaded");
    expect(logs.query()).toEqual([expect.objectContaining({ module: name, msg: "loaded" })]);
    writeFileSync(join(directory, entry), code.replace("original", "updated"));
    expect(await reimportInstalledModule(name, tmpDir, { globalConfigPath })).toMatchObject({ name, description: "updated" });
    expect(readFileSync(join(directory, "state.json"), "utf8")).toBe('{"retained":true}');
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

  it("calls the activation disposer during unloadAll", async () => {
    const flagPath = join(tmpDir, "unloaded.flag");
    writeModule(tmpDir, "unload", `
      import { writeFileSync } from "node:fs";
      export default {
        name: "unload-module",
        onLoad: () => ({
          dispose: () => {
            writeFileSync(${JSON.stringify(flagPath)}, "unloaded");
          },
        }),
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

  it("rejects an invalid declaration before registering its config slices", async () => {
    writeModule(tmpDir, "invalid-config-owner", `
      export default {
        name: "invalid-config-owner",
        enabled: true,
        configSlices: [{
          key: "invalidSlice",
          description: "must never register",
          sanitize: (raw) => raw,
          merge: (_base, override) => override,
          scopeConfigSafety: "authority",
          schemaSource: { relativePath: "invalid.ts", typeName: "InvalidConfig" },
        }],
      };
    `);

    expect(await discoverModules(tmpDir)).toEqual([]);
    expect(getRegisteredConfigSlice("invalidSlice")).toBeUndefined();
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
