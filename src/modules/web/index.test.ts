import { describe, expect, it } from "vitest";
import { ModuleStorage } from "#core/modules/module-storage.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import webModule from "./index.js";

const stubCtx: ModuleContext = {
  cwd: "/tmp/test",
  verbose: false,
  config: {} as ModuleContext["config"],
  storage: new ModuleStorage("/tmp/test", "web"),
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
    resolveAgentDef: () => undefined,
    resolveSkillsPrompt: () => "",
    probeHealthChecks: async () => ({}),
  };

describe("webModule", () => {
  it("has correct metadata", () => {
    expect(webModule.name).toBe("web");
    expect(webModule.version).toBe("1.0.0");
    expect(webModule.description).toContain("HTTP");
  });

  it("registers a 'serve' CLI command", () => {
    const cmds = webModule.commands!(stubCtx);
    expect(cmds).toHaveLength(1);
    expect(cmds[0].name()).toBe("serve");
  });

  it("serve command has expected options", () => {
    const cmds = webModule.commands!(stubCtx);
    const cmd = cmds[0];
    const optNames = cmd.options.map((o) => o.long);
    expect(optNames).toContain("--port");
    expect(optNames).toContain("--model");
    expect(optNames).toContain("--verbose");
  });

  it("does not register tools or routes", () => {
    expect(webModule.tools).toBeUndefined();
    expect(webModule.routes).toBeUndefined();
  });

  it("has no dependencies", () => {
    expect(webModule.dependencies).toBeUndefined();
  });
});
