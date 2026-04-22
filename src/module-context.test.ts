/**
 * Tests for extended ModuleContext APIs (log, getSecret, listTools)
 * and the tools-as-function pattern.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initSecretStore, resetSecretStore } from "#core/config/secrets.js";
import { initEventBus, resetEventBus } from "./core/events/event-bus.js";
import { ModuleLoader } from "./core/modules/module-loader.js";
import type { KotaModule, ModuleContext, ToolDef } from "./core/modules/module-types.js";
import { resolveModuleTools } from "./core/modules/module-types.js";
import { clearCustomTools, executeTool, registerTool } from "./core/tools/index.js";
import { clearCustomGroups, resetGroups } from "./core/tools/tool-groups.js";

beforeEach(() => {
  clearCustomTools();
  clearCustomGroups();
  resetGroups();
  resetSecretStore();
  resetEventBus();
});

afterEach(() => {
  clearCustomTools();
  clearCustomGroups();
  resetGroups();
  resetSecretStore();
  resetEventBus();
});

// ── ctx.log ──────────────────────────────────────────────────────────────

describe("ModuleContext.log", () => {
  it("provides info/warn/error/debug methods", async () => {
    const onLoad = vi.fn();
    const loader = new ModuleLoader({});
    await loader.load({ name: "log-test", onLoad });

    const ctx: ModuleContext = onLoad.mock.calls[0][0];
    expect(typeof ctx.log.info).toBe("function");
    expect(typeof ctx.log.warn).toBe("function");
    expect(typeof ctx.log.error).toBe("function");
    expect(typeof ctx.log.debug).toBe("function");
  });

  it("prefixes messages with [module:<name>]", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const onLoad = vi.fn();
    const loader = new ModuleLoader({});
    await loader.load({ name: "my-mod", onLoad });

    const ctx: ModuleContext = onLoad.mock.calls[0][0];
    ctx.log.info("hello world");
    expect(errSpy).toHaveBeenCalledWith("[module:my-mod] hello world");

    ctx.log.warn("watch out");
    expect(errSpy).toHaveBeenCalledWith("[module:my-mod] WARN: watch out");

    ctx.log.error("something broke");
    expect(errSpy).toHaveBeenCalledWith("[module:my-mod] ERROR: something broke");

    errSpy.mockRestore();
  });

  it("debug only logs in verbose mode", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // Non-verbose — debug is silent
    const onLoadQuiet = vi.fn();
    const loaderQuiet = new ModuleLoader({}, false);
    await loaderQuiet.load({ name: "quiet-mod", onLoad: onLoadQuiet });
    const ctxQuiet: ModuleContext = onLoadQuiet.mock.calls[0][0];
    ctxQuiet.log.debug("hidden");
    expect(errSpy).not.toHaveBeenCalled();

    // Verbose — debug logs
    const onLoadVerbose = vi.fn();
    const loaderVerbose = new ModuleLoader({}, true);
    await loaderVerbose.load({ name: "verbose-mod", onLoad: onLoadVerbose });
    const ctxVerbose: ModuleContext = onLoadVerbose.mock.calls[0][0];
    ctxVerbose.log.debug("visible");
    // The verbose loader also logs "Module loaded" — find the debug message
    const debugCall = errSpy.mock.calls.find(
      (call) => typeof call[0] === "string" && call[0].includes("DEBUG:"),
    );
    expect(debugCall).toBeTruthy();
    expect(debugCall![0]).toContain("[module:verbose-mod] DEBUG: visible");

    errSpy.mockRestore();
  });
});

// ── ctx.getSecret ────────────────────────────────────────────────────────

describe("ModuleContext.getSecret", () => {
  it("returns null when secret store is not initialized", async () => {
    const onLoad = vi.fn();
    const loader = new ModuleLoader({});
    await loader.load({ name: "secret-test", onLoad });

    const ctx: ModuleContext = onLoad.mock.calls[0][0];
    expect(ctx.getSecret("MY_KEY")).toBeNull();
  });

  it("returns secret value when store is initialized", async () => {
    const store = initSecretStore("/tmp/test-secret-ctx");
    store.set("API_KEY", "test-value-123", "project");

    const onLoad = vi.fn();
    const loader = new ModuleLoader({});
    await loader.load({ name: "secret-test2", onLoad });

    const ctx: ModuleContext = onLoad.mock.calls[0][0];
    expect(ctx.getSecret("API_KEY")).toBe("test-value-123");
    expect(ctx.getSecret("NONEXISTENT")).toBeNull();
  });
});

// ── ctx.listTools ────────────────────────────────────────────────────────

describe("ModuleContext.listTools", () => {
  it("returns names of registered tools", async () => {
    registerTool(
      { name: "tool_alpha", description: "Test", input_schema: { type: "object", properties: {} } },
      async () => ({ content: "ok" }),
    );
    registerTool(
      { name: "tool_beta", description: "Test", input_schema: { type: "object", properties: {} } },
      async () => ({ content: "ok" }),
    );

    const onLoad = vi.fn();
    const loader = new ModuleLoader({});
    await loader.load({ name: "tools-test", onLoad });

    const ctx: ModuleContext = onLoad.mock.calls[0][0];
    const tools = ctx.listTools();
    expect(tools).toContain("tool_alpha");
    expect(tools).toContain("tool_beta");
  });

  it("reflects tools registered by other modules", async () => {
    const loader = new ModuleLoader({});

    await loader.load({
      name: "provider-mod",
      tools: [{
        tool: { name: "provided_tool", description: "Provided", input_schema: { type: "object", properties: {} } },
        runner: async () => ({ content: "ok" }),
        risk: "safe" as const, kind: "discovery" as const,
      }],
    });

    const onLoad = vi.fn();
    await loader.load({ name: "consumer-mod", onLoad });

    const ctx: ModuleContext = onLoad.mock.calls[0][0];
    expect(ctx.listTools()).toContain("provided_tool");
  });
});

// ── tools as function ────────────────────────────────────────────────────

describe("tools as factory function", () => {
  it("resolves tools from a factory function during load", async () => {
    const loader = new ModuleLoader({});

    const mod: KotaModule = {
      name: "factory-mod",
      tools: (ctx) => [{
        tool: {
          name: "factory_tool",
          description: `Tool in ${ctx.cwd}`,
          input_schema: { type: "object", properties: {} },
        },
        runner: async () => ({ content: `from factory in ${ctx.cwd}` }),
        risk: "safe" as const, kind: "discovery" as const,
      }],
    };

    await loader.load(mod);
    expect(loader.getToolCount()).toBe(1);

    const result = await executeTool("factory_tool", {});
    expect(result.content).toContain("from factory");
  });

  it("tool runner can access ctx.getSecret via closure", async () => {
    const store = initSecretStore("/tmp/test-factory");
    store.set("TOKEN", "my-secret-token", "project");

    const loader = new ModuleLoader({});

    const mod: KotaModule = {
      name: "secret-factory",
      tools: (ctx) => [{
        tool: {
          name: "secret_tool",
          description: "Uses secret",
          input_schema: { type: "object", properties: {} },
        },
        runner: async () => {
          const value = ctx.getSecret("TOKEN");
          return { content: value ? "found" : "not found" };
        },
        risk: "safe" as const, kind: "discovery" as const,
      }],
    };

    await loader.load(mod);
    const result = await executeTool("secret_tool", {});
    expect(result.content).toBe("found");
  });

  it("tool runner can access ctx.log via closure", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const loader = new ModuleLoader({}, true);

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
        risk: "safe" as const, kind: "discovery" as const,
      }],
    };

    await loader.load(mod);
    const result = await executeTool("log_tool", {});
    expect(result.content).toBe("done");

    const logCall = errSpy.mock.calls.find(
      (call) => typeof call[0] === "string" && call[0].includes("tool executed"),
    );
    expect(logCall).toBeTruthy();
    expect(logCall![0]).toContain("[module:logging-factory]");

    errSpy.mockRestore();
  });

  it("mixes static and factory tools across modules", async () => {
    const loader = new ModuleLoader({});

    // Static tools
    await loader.load({
      name: "static-mod",
      tools: [{
        tool: { name: "static_tool", description: "Static", input_schema: { type: "object", properties: {} } },
        runner: async () => ({ content: "static" }),
        risk: "safe" as const, kind: "discovery" as const,
      }],
    });

    // Factory tools
    await loader.load({
      name: "factory-mod",
      tools: (_ctx) => [{
        tool: { name: "dynamic_tool", description: "Dynamic", input_schema: { type: "object", properties: {} } },
        runner: async () => ({ content: "dynamic" }),
        risk: "safe" as const, kind: "discovery" as const,
      }],
    });

    expect(loader.getToolCount()).toBe(2);

    const r1 = await executeTool("static_tool", {});
    expect(r1.content).toBe("static");
    const r2 = await executeTool("dynamic_tool", {});
    expect(r2.content).toBe("dynamic");
  });

  it("getToolCount tracks factory tools correctly", async () => {
    const loader = new ModuleLoader({});

    await loader.load({
      name: "multi-factory",
      tools: (_ctx) => [
        {
          tool: { name: "ft1", description: "F1", input_schema: { type: "object", properties: {} } },
          runner: async () => ({ content: "1" }),
          risk: "safe" as const, kind: "discovery" as const,
        },
        {
          tool: { name: "ft2", description: "F2", input_schema: { type: "object", properties: {} } },
          runner: async () => ({ content: "2" }),
          risk: "safe" as const, kind: "discovery" as const,
        },
      ],
    });

    expect(loader.getToolCount()).toBe(2);

    await loader.unload("multi-factory");
    expect(loader.getToolCount()).toBe(0);
  });
});

// ── resolveModuleTools ───────────────────────────────────────────────────

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
    getModuleSummaries: () => [],
    getModuleConfig: () => undefined,
    log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    getSecret: () => null,
    listTools: () => [],
    events: { emit: () => {}, subscribe: () => () => {} },
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
  } as ModuleContext;

  it("returns empty array when tools is undefined", () => {
    expect(resolveModuleTools({ name: "empty" })).toEqual([]);
  });

  it("returns array directly for static tools", () => {
    const tools: ToolDef[] = [{
      tool: { name: "t", description: "T", input_schema: { type: "object", properties: {} } },
      runner: async () => ({ content: "" }),
      risk: "safe", kind: "discovery",
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

// ── ctx.events ──────────────────────────────────────────────────────────

describe("ModuleContext.events", () => {
  it("provides emit method", async () => {
    const onLoad = vi.fn();
    const loader = new ModuleLoader({});
    await loader.load({ name: "events-test", onLoad });

    const ctx: ModuleContext = onLoad.mock.calls[0][0];
    expect(typeof ctx.events.emit).toBe("function");
  });

  it("emit is no-op when bus is not connected", async () => {
    const onLoad = vi.fn();
    const loader = new ModuleLoader({});
    await loader.load({ name: "no-bus", onLoad });

    const ctx: ModuleContext = onLoad.mock.calls[0][0];
    // Should not throw
    ctx.events.emit("test.event", { value: 1 });
  });

  it("emits events to the bus", async () => {
    const bus = initEventBus();
    const received: unknown[] = [];
    bus.on("custom.event", (payload) => received.push(payload));

    const onLoad = vi.fn();
    const loader = new ModuleLoader({});
    await loader.load({ name: "emitter", onLoad });
    loader.setBus(bus);

    const ctx: ModuleContext = onLoad.mock.calls[0][0];
    ctx.events.emit("custom.event", { key: "value" });

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({ key: "value" });
  });

  it("tool runner can use ctx.events.emit via closure", async () => {
    const bus = initEventBus();
    const emitted: unknown[] = [];
    bus.on("tool.ran", (p) => emitted.push(p));

    const loader = new ModuleLoader({});
    await loader.load({
      name: "event-tool-mod",
      tools: (ctx) => [{
        tool: {
          name: "event_emitter_tool",
          description: "Emits an event",
          input_schema: { type: "object", properties: {} },
        },
        runner: async () => {
          ctx.events.emit("tool.ran", { tool: "event_emitter_tool" });
          return { content: "emitted" };
        },
        risk: "safe" as const, kind: "discovery" as const,
      }],
    });
    loader.setBus(bus);

    const result = await executeTool("event_emitter_tool", {});
    expect(result.content).toBe("emitted");
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toEqual({ tool: "event_emitter_tool" });
  });
});

// ── ctx.createSession ───────────────────────────────────────────────────

describe("ModuleContext.createSession", () => {
  it("throws when no session factory is set", async () => {
    const onLoad = vi.fn();
    const loader = new ModuleLoader({});
    await loader.load({ name: "no-factory", onLoad });

    const ctx: ModuleContext = onLoad.mock.calls[0][0];
    expect(() => ctx.createSession()).toThrow("Session factory not available");
  });

  it("creates session when factory is set", async () => {
    const mockSession = {
      send: vi.fn(async () => "response from session"),
      close: vi.fn(),
    };
    const factory = vi.fn(() => mockSession);

    const onLoad = vi.fn();
    const loader = new ModuleLoader({});
    loader.setSessionFactory(factory);
    await loader.load({ name: "with-factory", onLoad });

    const ctx: ModuleContext = onLoad.mock.calls[0][0];
    const session = ctx.createSession({ label: "test-session" });

    expect(factory).toHaveBeenCalledWith({ label: "test-session" });
    expect(session).toBe(mockSession);
  });

  it("passes default empty options when none provided", async () => {
    const factory = vi.fn(() => ({
      send: async () => "",
      close: () => {},
    }));

    const onLoad = vi.fn();
    const loader = new ModuleLoader({});
    loader.setSessionFactory(factory);
    await loader.load({ name: "default-opts", onLoad });

    const ctx: ModuleContext = onLoad.mock.calls[0][0];
    ctx.createSession();

    expect(factory).toHaveBeenCalledWith({});
  });

  it("session send and close work through the proxy", async () => {
    const sendFn = vi.fn(async (prompt: string) => `echo: ${prompt}`);
    const closeFn = vi.fn();
    const factory = vi.fn(() => ({ send: sendFn, close: closeFn }));

    const onLoad = vi.fn();
    const loader = new ModuleLoader({});
    loader.setSessionFactory(factory);
    await loader.load({ name: "session-proxy", onLoad });

    const ctx: ModuleContext = onLoad.mock.calls[0][0];
    const session = ctx.createSession();

    const result = await session.send("hello");
    expect(result).toBe("echo: hello");
    expect(sendFn).toHaveBeenCalledWith("hello");

    session.close();
    expect(closeFn).toHaveBeenCalled();
  });

  it("tool runner can create sessions via closure", async () => {
    const factory = vi.fn(() => ({
      send: async () => "sub-agent says hi",
      close: () => {},
    }));

    const loader = new ModuleLoader({});
    loader.setSessionFactory(factory);
    await loader.load({
      name: "session-tool-mod",
      tools: (ctx) => [{
        tool: {
          name: "spawn_session_tool",
          description: "Spawns a sub-session",
          input_schema: { type: "object", properties: {} },
        },
        runner: async () => {
          const session = ctx.createSession({ label: "sub-task" });
          const result = await session.send("do something");
          session.close();
          return { content: result };
        },
        risk: "safe" as const, kind: "discovery" as const,
      }],
    });

    const result = await executeTool("spawn_session_tool", {});
    expect(result.content).toBe("sub-agent says hi");
    expect(factory).toHaveBeenCalledWith({ label: "sub-task" });
  });
});
