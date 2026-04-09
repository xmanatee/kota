import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { discoverExtensions } from "./extension-discovery.js";
import { ExtensionLoader } from "./extension-loader.js";
import { clearCustomGroups, enableGroup, filterTools, resetGroups, TOOL_GROUPS } from "./tool-groups.js";
import { clearCustomTools, executeTool, getAllTools } from "./tools/index.js";

function makeTmpDir(): string {
  const dir = join(tmpdir(), `kota-ext-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Write a single-file code extension to .kota/extensions/<name>/index.mjs */
function writeExtension(dir: string, name: string, code: string): void {
  const extDir = join(dir, ".kota", "extensions", name);
  mkdirSync(extDir, { recursive: true });
  writeFileSync(join(extDir, "index.mjs"), code);
}

describe("discoverExtensions", () => {
  let tmpDir: string;
  let loader: ExtensionLoader;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    clearCustomTools();
    clearCustomGroups();
    resetGroups();
    loader = new ExtensionLoader({}, false);
  });

  afterEach(async () => {
    await loader.unloadAll();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("discovers nothing when .kota/extensions/ does not exist", async () => {
    const modules = await discoverExtensions(tmpDir);
    expect(modules).toEqual([]);
  });

  it("discovers and loads a simple extension with one tool", async () => {
    writeExtension(tmpDir, "hello", `
      export default {
        name: "hello-extension",
        tools: [{
          tool: {
            name: "hello_world",
            description: "Says hello",
            input_schema: { type: "object", properties: {} },
          },
          runner: async () => ({ content: "Hello from extension!" }),
        }],
      };
    `);

    const modules = await discoverExtensions(tmpDir);
    expect(modules).toHaveLength(1);
    expect(modules[0].name).toBe("hello-extension");

    await loader.loadAll(modules);
    expect(loader.getExtensionCount()).toBe(1);
    expect(loader.getToolCount()).toBe(1);

    const result = await executeTool("hello_world", {});
    expect(result.content).toBe("Hello from extension!");
  });

  it("registers tool into a group when group is specified", async () => {
    writeExtension(tmpDir, "grouped", `
      export default {
        name: "grouped-extension",
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

    const modules = await discoverExtensions(tmpDir);
    await loader.loadAll(modules);

    expect(TOOL_GROUPS.analysis).toEqual(["custom_analyzer"]);

    // Tool should NOT appear in filtered tools until group is enabled
    const beforeEnable = filterTools(getAllTools());
    expect(beforeEnable.some((t) => t.name === "custom_analyzer")).toBe(false);

    enableGroup("analysis");
    const afterEnable = filterTools(getAllTools());
    expect(afterEnable.some((t) => t.name === "custom_analyzer")).toBe(true);
  });

  it("ungrouped extension tools are always available", async () => {
    writeExtension(tmpDir, "always", `
      export default {
        name: "always-extension",
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

    const modules = await discoverExtensions(tmpDir);
    await loader.loadAll(modules);

    const filtered = filterTools(getAllTools());
    expect(filtered.some((t) => t.name === "always_available")).toBe(true);
  });

  it("calls onLoad with ExtensionContext", async () => {
    writeExtension(tmpDir, "lifecycle", `
      let loaded = false;
      export default {
        name: "lifecycle-extension",
        onLoad: (ctx) => {
          loaded = true;
          if (!ctx.cwd || typeof ctx.verbose !== "boolean" || typeof ctx.registerGroup !== "function") {
            throw new Error("Invalid ExtensionContext");
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

    const modules = await discoverExtensions(tmpDir);
    await loader.loadAll(modules);
    const result = await executeTool("check_loaded", {});
    expect(result.content).toBe("yes");
  });

  it("calls onUnload during unloadAll", async () => {
    const flagPath = join(tmpDir, "unloaded.flag");
    writeExtension(tmpDir, "unload", `
      import { writeFileSync } from "node:fs";
      export default {
        name: "unload-extension",
        onUnload: () => {
          writeFileSync(${JSON.stringify(flagPath)}, "unloaded");
        },
      };
    `);

    const modules = await discoverExtensions(tmpDir);
    await loader.loadAll(modules);
    expect(loader.getExtensionCount()).toBe(1);

    await loader.unloadAll();
    expect(loader.getExtensionCount()).toBe(0);

    const { existsSync } = await import("node:fs");
    expect(existsSync(flagPath)).toBe(true);
  });

  it("skips extensions without a name", async () => {
    writeExtension(tmpDir, "bad", `
      export default { tools: [] };
    `);

    const modules = await discoverExtensions(tmpDir);
    // adaptExport logs an error and the extension is skipped
    expect(modules).toHaveLength(0);
  });

  it("rejects duplicate extension names via ExtensionLoader", async () => {
    writeExtension(tmpDir, "a", `export default { name: "dupe" };`);
    writeExtension(tmpDir, "b", `export default { name: "dupe" };`);

    const modules = await discoverExtensions(tmpDir);
    expect(modules).toHaveLength(2);

    // ExtensionLoader rejects the duplicate — first loads, second errors silently
    await loader.loadAll(modules);
    expect(loader.getExtensionCount()).toBe(1);
  });

  it("discovers extensions in alphabetical directory order", async () => {
    writeExtension(tmpDir, "z-last", `export default { name: "z-last" };`);
    writeExtension(tmpDir, "a-first", `export default { name: "a-first" };`);
    writeExtension(tmpDir, "m-middle", `export default { name: "m-middle" };`);

    const modules = await discoverExtensions(tmpDir);
    expect(modules.map((m) => m.name)).toEqual(["a-first", "m-middle", "z-last"]);
  });

  it("ignores directories with no recognized extension format", async () => {
    const extDir = join(tmpDir, ".kota", "extensions", "unknown");
    mkdirSync(extDir, { recursive: true });
    writeFileSync(join(extDir, "readme.md"), "# Not an extension");
    writeFileSync(join(extDir, "data.json"), "{}");
    writeExtension(tmpDir, "real", `export default { name: "real" };`);

    const modules = await discoverExtensions(tmpDir);
    expect(modules).toHaveLength(1);
    expect(modules[0].name).toBe("real");
  });

  it("cleans up tools on ExtensionLoader.unloadAll", async () => {
    writeExtension(tmpDir, "cleanup", `
      export default {
        name: "cleanup-extension",
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

    const modules = await discoverExtensions(tmpDir);
    await loader.loadAll(modules);

    expect(TOOL_GROUPS.temp_group).toEqual(["temp_tool"]);
    const result = await executeTool("temp_tool", {});
    expect(result.content).toBe("temp");

    await loader.unloadAll();

    // Tool should be gone
    const result2 = await executeTool("temp_tool", {});
    expect(result2.is_error).toBe(true);
  });

  it("registerGroup from ExtensionContext creates groups with auto-detect pattern", async () => {
    writeExtension(tmpDir, "custom-group", `
      export default {
        name: "custom-group-extension",
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

    const modules = await discoverExtensions(tmpDir);
    await loader.loadAll(modules);

    expect(TOOL_GROUPS.email).toContain("send_email");
    expect(TOOL_GROUPS.email).toContain("read_inbox");
  });

  it("discovers a manifest.json extension", async () => {
    const extDir = join(tmpDir, ".kota", "extensions", "manifest-ext");
    mkdirSync(extDir, { recursive: true });
    writeFileSync(
      join(extDir, "manifest.json"),
      JSON.stringify({
        name: "manifest-ext",
        version: "1.0.0",
      }),
    );

    const modules = await discoverExtensions(tmpDir);
    expect(modules).toHaveLength(1);
    expect(modules[0].name).toBe("manifest-ext");
  });

  it("discovers a packaged extension via package.json main field", async () => {
    const extDir = join(tmpDir, ".kota", "extensions", "packaged-ext");
    mkdirSync(join(extDir, "dist"), { recursive: true });
    writeFileSync(
      join(extDir, "package.json"),
      JSON.stringify({ name: "packaged-ext", main: "dist/index.js" }),
    );
    writeFileSync(
      join(extDir, "dist", "index.js"),
      `export default { name: "packaged-ext", tools: [] };`,
    );

    const modules = await discoverExtensions(tmpDir);
    expect(modules).toHaveLength(1);
    expect(modules[0].name).toBe("packaged-ext");
  });
});
