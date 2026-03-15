import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PluginManager } from "./plugin-loader.js";
import { clearCustomTools, allTools, executeTool } from "./tools/index.js";
import { resetGroups, clearCustomGroups, enableGroup, filterTools, TOOL_GROUPS } from "./tool-groups.js";

function makeTmpDir(): string {
  const dir = join(tmpdir(), `kota-plugin-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writePlugin(dir: string, name: string, code: string): void {
  const pluginDir = join(dir, ".kota", "plugins");
  mkdirSync(pluginDir, { recursive: true });
  writeFileSync(join(pluginDir, name), code);
}

describe("PluginManager", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    clearCustomTools();
    clearCustomGroups();
    resetGroups();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("loads nothing when .kota/plugins/ does not exist", async () => {
    const pm = new PluginManager();
    await pm.loadAll(tmpDir);
    expect(pm.getPluginCount()).toBe(0);
    expect(pm.getLoadedPlugins()).toEqual([]);
  });

  it("loads a simple plugin with one tool", async () => {
    writePlugin(tmpDir, "hello.mjs", `
      export default {
        name: "hello-plugin",
        tools: [{
          tool: {
            name: "hello_world",
            description: "Says hello",
            input_schema: { type: "object", properties: {} },
          },
          runner: async () => ({ content: "Hello from plugin!" }),
        }],
      };
    `);

    const pm = new PluginManager();
    await pm.loadAll(tmpDir);
    expect(pm.getPluginCount()).toBe(1);
    expect(pm.getLoadedPlugins()).toEqual(["hello-plugin"]);
    expect(pm.getToolCount()).toBe(1);

    // Tool should be callable via executeTool
    const result = await executeTool("hello_world", {});
    expect(result.content).toBe("Hello from plugin!");
  });

  it("registers tool into a group when group is specified", async () => {
    writePlugin(tmpDir, "grouped.mjs", `
      export default {
        name: "grouped-plugin",
        tools: [{
          tool: {
            name: "custom_analyzer",
            description: "Analyze something",
            input_schema: { type: "object", properties: {} },
          },
          runner: async () => ({ content: "analyzed" }),
          group: "analysis",
        }],
      };
    `);

    const pm = new PluginManager();
    await pm.loadAll(tmpDir);

    // "analysis" group should exist with our tool
    expect(TOOL_GROUPS["analysis"]).toEqual(["custom_analyzer"]);

    // Tool should NOT appear in filtered tools until group is enabled
    const beforeEnable = filterTools(allTools);
    const hasAnalyzer = beforeEnable.some((t) => t.name === "custom_analyzer");
    expect(hasAnalyzer).toBe(false);

    // Enable the group
    enableGroup("analysis");
    const afterEnable = filterTools(allTools);
    expect(afterEnable.some((t) => t.name === "custom_analyzer")).toBe(true);
  });

  it("ungrouped plugin tools are always available", async () => {
    writePlugin(tmpDir, "always.mjs", `
      export default {
        name: "always-plugin",
        tools: [{
          tool: {
            name: "always_available",
            description: "Always here",
            input_schema: { type: "object", properties: {} },
          },
          runner: async () => ({ content: "always" }),
        }],
      };
    `);

    const pm = new PluginManager();
    await pm.loadAll(tmpDir);

    // Ungrouped custom tools pass through filterTools regardless of enabled groups
    const filtered = filterTools(allTools);
    expect(filtered.some((t) => t.name === "always_available")).toBe(true);
  });

  it("calls onLoad with PluginContext", async () => {
    writePlugin(tmpDir, "lifecycle.mjs", `
      let loaded = false;
      export default {
        name: "lifecycle-plugin",
        onLoad: (ctx) => {
          loaded = true;
          if (!ctx.cwd || typeof ctx.verbose !== "boolean" || typeof ctx.registerGroup !== "function") {
            throw new Error("Invalid PluginContext");
          }
        },
        tools: [{
          tool: {
            name: "check_loaded",
            description: "Check if onLoad ran",
            input_schema: { type: "object", properties: {} },
          },
          runner: async () => ({ content: loaded ? "yes" : "no" }),
        }],
      };
    `);

    const pm = new PluginManager();
    await pm.loadAll(tmpDir);
    const result = await executeTool("check_loaded", {});
    expect(result.content).toBe("yes");
  });

  it("calls onUnload during unloadAll", async () => {
    // Use a file as a flag since the plugin runs in-process
    const flagPath = join(tmpDir, "unloaded.flag");
    writePlugin(tmpDir, "unload.mjs", `
      import { writeFileSync } from "node:fs";
      export default {
        name: "unload-plugin",
        onUnload: () => {
          writeFileSync(${JSON.stringify(flagPath)}, "unloaded");
        },
      };
    `);

    const pm = new PluginManager();
    await pm.loadAll(tmpDir);
    expect(pm.getPluginCount()).toBe(1);

    await pm.unloadAll();
    expect(pm.getPluginCount()).toBe(0);

    const { existsSync } = await import("node:fs");
    expect(existsSync(flagPath)).toBe(true);
  });

  it("rejects plugins without a name", async () => {
    writePlugin(tmpDir, "bad.mjs", `
      export default { tools: [] };
    `);

    const pm = new PluginManager();
    // Should not throw — just logs an error and skips
    await pm.loadAll(tmpDir);
    expect(pm.getPluginCount()).toBe(0);
  });

  it("rejects duplicate plugin names", async () => {
    writePlugin(tmpDir, "a.mjs", `export default { name: "dupe" };`);
    writePlugin(tmpDir, "b.mjs", `export default { name: "dupe" };`);

    const pm = new PluginManager();
    await pm.loadAll(tmpDir);
    // First one loads, second is rejected
    expect(pm.getPluginCount()).toBe(1);
  });

  it("loads plugins in alphabetical order", async () => {
    writePlugin(tmpDir, "z-last.mjs", `export default { name: "z-last" };`);
    writePlugin(tmpDir, "a-first.mjs", `export default { name: "a-first" };`);
    writePlugin(tmpDir, "m-middle.mjs", `export default { name: "m-middle" };`);

    const pm = new PluginManager();
    await pm.loadAll(tmpDir);
    expect(pm.getLoadedPlugins()).toEqual(["a-first", "m-middle", "z-last"]);
  });

  it("ignores non-JS files in plugins directory", async () => {
    const pluginDir = join(tmpDir, ".kota", "plugins");
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(join(pluginDir, "readme.md"), "# Not a plugin");
    writeFileSync(join(pluginDir, "data.json"), "{}");
    writePlugin(tmpDir, "real.mjs", `export default { name: "real" };`);

    const pm = new PluginManager();
    await pm.loadAll(tmpDir);
    expect(pm.getPluginCount()).toBe(1);
  });

  it("cleans up tools and groups on unloadAll", async () => {
    writePlugin(tmpDir, "cleanup.mjs", `
      export default {
        name: "cleanup-plugin",
        tools: [{
          tool: {
            name: "temp_tool",
            description: "Temporary",
            input_schema: { type: "object", properties: {} },
          },
          runner: async () => ({ content: "temp" }),
          group: "temp_group",
        }],
      };
    `);

    const pm = new PluginManager();
    await pm.loadAll(tmpDir);

    expect(TOOL_GROUPS["temp_group"]).toEqual(["temp_tool"]);
    const result = await executeTool("temp_tool", {});
    expect(result.content).toBe("temp");

    await pm.unloadAll();

    // Group should be gone
    expect(TOOL_GROUPS["temp_group"]).toBeUndefined();

    // Tool should be gone
    const result2 = await executeTool("temp_tool", {});
    expect(result2.is_error).toBe(true);
  });

  it("registerGroup from PluginContext creates groups with auto-detect pattern", async () => {
    writePlugin(tmpDir, "custom-group.mjs", `
      export default {
        name: "custom-group-plugin",
        onLoad: (ctx) => {
          ctx.registerGroup("email", ["send_email", "read_inbox"], /\\b(email|mail|inbox|send.?message)\\b/i);
        },
        tools: [
          {
            tool: {
              name: "send_email",
              description: "Send an email",
              input_schema: { type: "object", properties: { to: { type: "string" } }, required: ["to"] },
            },
            runner: async (input) => ({ content: "sent to " + input.to }),
            group: "email",
          },
          {
            tool: {
              name: "read_inbox",
              description: "Read inbox",
              input_schema: { type: "object", properties: {} },
            },
            runner: async () => ({ content: "0 unread" }),
            group: "email",
          },
        ],
      };
    `);

    const pm = new PluginManager();
    await pm.loadAll(tmpDir);

    expect(TOOL_GROUPS["email"]).toContain("send_email");
    expect(TOOL_GROUPS["email"]).toContain("read_inbox");
  });
});
