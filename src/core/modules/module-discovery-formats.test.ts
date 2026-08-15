import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearCustomTools } from "#core/tools/index.js";
import { clearCustomGroups, resetGroups, TOOL_GROUPS } from "#core/tools/tool-groups.js";
import { createRuntimeModuleLoader } from "./module-context.test-helpers.js";
import { discoverModules } from "./module-discovery.js";
import type { ModuleLoader } from "./module-loader.js";

describe("installed module formats", () => {
  let projectDir: string;
  let globalConfigPath: string;
  let loader: ModuleLoader;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "kota-module-formats-"));
    globalConfigPath = join(projectDir, "machine-config.json");
    writeFileSync(globalConfigPath, JSON.stringify({ trustedProjects: [projectDir] }));
    clearCustomTools();
    clearCustomGroups();
    resetGroups();
    loader = createRuntimeModuleLoader({}, false, { globalConfigPath });
  });

  afterEach(async () => {
    await loader.unloadAll();
    rmSync(projectDir, { recursive: true, force: true });
  });

  function writeModule(name: string, code: string): void {
    const moduleDir = join(projectDir, ".kota", "modules", name);
    mkdirSync(moduleDir, { recursive: true });
    writeFileSync(join(moduleDir, "index.mjs"), code);
  }

  const discover = () => discoverModules(projectDir, false, { globalConfigPath });

  it("registers ModuleContext groups with auto-detect patterns", async () => {
    writeModule("custom-group", `
      export default {
        name: "custom-group-module",
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
            effect: { kind: "write", scope: "local-fs", idempotent: false, openWorld: false },
            group: "email",
          },
          {
            tool: {
              name: "read_inbox",
              description: "Read inbox",
              input_schema: { type: "object", properties: {} },
            },
            runner: async () => ({ content: "0 unread" }),
            effect: { kind: "read", scope: "local-fs", idempotent: true, openWorld: false },
            group: "email",
          },
        ],
      };
    `);

    await loader.loadAll(await discover());
    expect(TOOL_GROUPS.email).toEqual(expect.arrayContaining(["send_email", "read_inbox"]));
  });

  it("discovers a manifest.json module", async () => {
    const moduleDir = join(projectDir, ".kota", "modules", "manifest-ext");
    mkdirSync(moduleDir, { recursive: true });
    writeFileSync(
      join(moduleDir, "manifest.json"),
      JSON.stringify({ name: "manifest-ext", version: "1.0.0" }),
    );

    const modules = await discover();
    expect(modules).toHaveLength(1);
    expect(modules[0].name).toBe("manifest-ext");
  });

  it("discovers a packaged module via package.json main field", async () => {
    const moduleDir = join(projectDir, ".kota", "modules", "packaged-ext");
    mkdirSync(join(moduleDir, "dist"), { recursive: true });
    writeFileSync(
      join(moduleDir, "package.json"),
      JSON.stringify({ name: "packaged-ext", main: "dist/index.js" }),
    );
    writeFileSync(
      join(moduleDir, "dist", "index.js"),
      `export default { name: "packaged-ext", tools: [] };`,
    );

    const modules = await discover();
    expect(modules).toHaveLength(1);
    expect(modules[0].name).toBe("packaged-ext");
  });
});
