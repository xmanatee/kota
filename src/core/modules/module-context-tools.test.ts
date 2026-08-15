import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getProjectSecretStore } from "#core/config/secrets.js";
import { legacyEffect } from "#core/tools/effect.js";
import { executeTool } from "#core/tools/index.js";
import {
  createRuntimeModuleLoader,
  installRenderingCapture,
  resetModuleContextTestState,
  TEXT_LOG_CONFIG,
} from "./module-context.test-helpers.js";
import type { KotaModule, ModuleContext, ToolDef } from "./module-types.js";
import { resolveModuleTools } from "./module-types.js";

beforeEach(() => {
  resetModuleContextTestState();
  vi.restoreAllMocks();
});

afterEach(resetModuleContextTestState);

describe("tools as factory function", () => {
  it("resolves tools from a factory function during load", async () => {
    const loader = createRuntimeModuleLoader({});

    const mod: KotaModule = {
      name: "factory-mod",
      tools: (ctx) => [{
        tool: {
          name: "factory_tool",
          description: `Tool in ${ctx.cwd}`,
          input_schema: { type: "object", properties: {} },
        },
        runner: async () => ({ content: `from factory in ${ctx.cwd}` }),
        effect: legacyEffect({ risk: "safe", kind: "discovery" }),
      }],
    };

    await loader.load(mod);
    expect(loader.getToolCount()).toBe(1);

    const result = await executeTool("factory_tool", {});
    expect(result.content).toContain("from factory");
  });

  it("tool runner can access ctx.getSecret via closure", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "module-context-factory-"));
    try {
      const store = getProjectSecretStore(projectDir);
      store.set(
        "KOTA_MODULE_CONTEXT_FACTORY_TOKEN",
        "my-secret-token",
        "project",
      );

      const loader = createRuntimeModuleLoader({});
      loader.setCwd(projectDir);

      const mod: KotaModule = {
        name: "secret-factory",
        tools: (ctx) => [{
          tool: {
            name: "secret_tool",
            description: "Uses secret",
            input_schema: { type: "object", properties: {} },
          },
          runner: async () => {
            const value = ctx.getSecret("KOTA_MODULE_CONTEXT_FACTORY_TOKEN");
            return { content: value ? "found" : "not found" };
          },
          effect: legacyEffect({ risk: "safe", kind: "discovery" }),
        }],
      };

      await loader.load(mod);
      const result = await executeTool("secret_tool", {});
      expect(result.content).toBe("found");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("tool runner can access ctx.log via closure", async () => {
    const chunks: string[] = [];
    installRenderingCapture(chunks);
    const loader = createRuntimeModuleLoader(TEXT_LOG_CONFIG, true);

    const mod: KotaModule = {
      name: "logging-factory",
      tools: (ctx) => [{
        tool: {
          name: "log_tool",
          description: "Logs stuff",
          input_schema: { type: "object", properties: {} },
        },
        runner: async () => {
          ctx.log.info("tool executed");
          return { content: "done" };
        },
        effect: legacyEffect({ risk: "safe", kind: "discovery" }),
      }],
    };

    await loader.load(mod);
    const result = await executeTool("log_tool", {});
    expect(result.content).toBe("done");

    const logCall = chunks.find((chunk) => chunk.includes("tool executed"));
    expect(logCall).toBeTruthy();
    expect(logCall).toContain("[module:logging-factory]");
  });

  it("mixes static and factory tools across modules", async () => {
    const loader = createRuntimeModuleLoader({});

    await loader.load({
      name: "static-mod",
      tools: [{
        tool: {
          name: "static_tool",
          description: "Static",
          input_schema: { type: "object", properties: {} },
        },
        runner: async () => ({ content: "static" }),
        effect: legacyEffect({ risk: "safe", kind: "discovery" }),
      }],
    });

    await loader.load({
      name: "factory-mod",
      tools: () => [{
        tool: {
          name: "dynamic_tool",
          description: "Dynamic",
          input_schema: { type: "object", properties: {} },
        },
        runner: async () => ({ content: "dynamic" }),
        effect: legacyEffect({ risk: "safe", kind: "discovery" }),
      }],
    });

    expect(loader.getToolCount()).toBe(2);
    expect((await executeTool("static_tool", {})).content).toBe("static");
    expect((await executeTool("dynamic_tool", {})).content).toBe("dynamic");
  });

  it("getToolCount tracks factory tools correctly", async () => {
    const loader = createRuntimeModuleLoader({});

    await loader.load({
      name: "multi-factory",
      tools: () => [
        {
          tool: {
            name: "ft1",
            description: "F1",
            input_schema: { type: "object", properties: {} },
          },
          runner: async () => ({ content: "1" }),
          effect: legacyEffect({ risk: "safe", kind: "discovery" }),
        },
        {
          tool: {
            name: "ft2",
            description: "F2",
            input_schema: { type: "object", properties: {} },
          },
          runner: async () => ({ content: "2" }),
          effect: legacyEffect({ risk: "safe", kind: "discovery" }),
        },
      ],
    });

    expect(loader.getToolCount()).toBe(2);
    await loader.unload("multi-factory");
    expect(loader.getToolCount()).toBe(0);
  });
});

describe("resolveModuleTools", () => {
  const dummyCtx = {
    cwd: "/tmp",
    verbose: false,
    config: {},
    storage: {} as ModuleContext["storage"],
    registerGroup: () => {},
    getRoutes: () => [],
    getContributedWorkflows: () => [],
    getContributedChannels: () => [],
    getContributedUiSurfaces: () => [],
    getContributedControlRoutes: () => [],
    getModuleSummaries: () => [],
    getModuleConfig: () => undefined,
    log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    getSecret: () => null,
    listTools: () => [],
    events: {
      emit: () => {},
      subscribe: () => () => {},
      emitExternal: () => {},
      subscribeExternal: () => () => {},
      listenerCount: () => 0,
    },
    createSession: () => ({ send: async () => "", close: () => {} }),
    registerProvider: () => {},
    getProvider: () => null,
    callTool: async () => ({ content: "" }),
    registerMiddleware: () => {},
    registerDynamicStateProvider: () => {},
    registerCleanupHook: () => {},
    registerPreSendHook: () => {},
    registerHarnessHook: () => {},
    resolveAgentDef: () => undefined,
    resolveSkillsPrompt: () => "",
    probeHealthChecks: async () => ({}),
    getRegisteredConfigKeys: () => new Set<string>(),
    client: {} as never,
  } as ModuleContext;

  it("returns empty array when tools is undefined", () => {
    expect(resolveModuleTools({ name: "empty" })).toEqual([]);
  });

  it("returns array directly for static tools", () => {
    const tools: ToolDef[] = [{
      tool: {
        name: "t",
        description: "T",
        input_schema: { type: "object", properties: {} },
      },
      runner: async () => ({ content: "" }),
      effect: legacyEffect({ risk: "safe", kind: "discovery" }),
    }];
    expect(resolveModuleTools({ name: "static", tools })).toBe(tools);
  });

  it("calls factory with context for function tools", () => {
    const factory = vi.fn(() => [] as ToolDef[]);
    resolveModuleTools({ name: "factory", tools: factory }, dummyCtx);
    expect(factory).toHaveBeenCalledWith(dummyCtx);
  });

  it("throws when factory tools have no context", () => {
    const mod: KotaModule = { name: "no-ctx", tools: () => [] };
    expect(() => resolveModuleTools(mod)).toThrow("no context provided");
  });
});
