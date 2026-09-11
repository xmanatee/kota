import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getScopeSecretStore } from "#core/config/secrets.js";
import { readOnlyLocalEffect } from "#core/tools/effect.js";
import { executeTool } from "#core/tools/index.js";
import {
  createRuntimeModuleLoader,
  installRenderingCapture,
  resetModuleContextTestState,
  TEXT_LOG_CONFIG,
} from "./module-context.test-helpers.js";
import { resolveModuleTools, type ToolDef } from "./module-types.js";

beforeEach(() => {
  resetModuleContextTestState();
  vi.restoreAllMocks();
});
afterEach(resetModuleContextTestState);

function tool(name: string, runner: ToolDef["runner"]): ToolDef {
  return {
    tool: { name, description: name, input_schema: { type: "object", properties: {} } },
    runner,
    effect: readOnlyLocalEffect(),
  };
}

it("executes static and context-bound factory tools and withdraws only the unloaded contribution", async () => {
  const loader = createRuntimeModuleLoader({});
  loader.setCwd("/factory-scope");
  try {
    await loader.load({ name: "static", tools: [tool("static_tool", async () => ({ content: "static" }))] });
    await loader.load({
      name: "factory",
      tools: (ctx) => [
        tool("factory_tool", async () => ({ content: ctx.cwd })),
        tool("second_tool", async () => ({ content: "second" })),
      ],
    });
    expect(loader.getToolCount()).toBe(3);
    expect((await executeTool("static_tool", {})).content).toBe("static");
    expect((await executeTool("factory_tool", {})).content).toBe("/factory-scope");
    expect((await executeTool("second_tool", {})).content).toBe("second");
    await loader.unload("factory");
    expect(loader.getToolCount()).toBe(1);
    expect((await executeTool("factory_tool", {})).is_error).toBe(true);
    expect((await executeTool("second_tool", {})).is_error).toBe(true);
    expect((await executeTool("static_tool", {})).content).toBe("static");
  } finally { await loader.unloadAll(); }
});

it("resolves scope secrets from the context retained by a tool factory", async () => {
  const root = mkdtempSync(join(tmpdir(), "module-context-factory-"));
  const loader = createRuntimeModuleLoader({});
  loader.setCwd(root);
  try {
    getScopeSecretStore(root).set("KOTA_MODULE_CONTEXT_FACTORY_TOKEN", "fixture-token", "scope");
    await loader.load({
      name: "secret-factory",
      tools: (ctx) => [tool("secret_tool", async () => ({
        content: ctx.getSecret("KOTA_MODULE_CONTEXT_FACTORY_TOKEN") ? "found" : "not found",
      }))],
    });
    expect((await executeTool("secret_tool", {})).content).toBe("found");
  } finally {
    await loader.unloadAll();
    rmSync(root, { recursive: true, force: true });
  }
});

it("attributes tool diagnostics to the module captured by its factory", async () => {
  const chunks: string[] = [];
  installRenderingCapture(chunks);
  const loader = createRuntimeModuleLoader(TEXT_LOG_CONFIG, true);
  try {
    await loader.load({
      name: "logging-factory",
      tools: (ctx) => [tool("log_tool", async () => {
        ctx.log.info("tool executed");
        return { content: "done" };
      })],
    });
    expect((await executeTool("log_tool", {})).content).toBe("done");
    expect(chunks.find((chunk) => chunk.includes("tool executed"))).toContain("[module:logging-factory]");
  } finally { await loader.unloadAll(); }
});

it("rejects factory resolution without a module context", () => {
  expect(() => resolveModuleTools({ name: "no-ctx", tools: () => [] })).toThrow("no context provided");
});
