import { describe, expect, it } from "vitest";
import { ExtensionStorage } from "../extension-storage.js";
import type { ExtensionContext } from "../extension-types.js";
import registryModule from "./registry.js";

const stubCtx: ExtensionContext = {
  cwd: "/tmp/test",
  verbose: false,
  config: {} as ExtensionContext["config"],
  storage: new ExtensionStorage("/tmp/test", "registry"),
  registerGroup: () => {},
  getRoutes: () => [],
  getContributedWorkflows: () => [],
  getModuleConfig: () => undefined,
  log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  getSecret: () => null,
  listTools: () => [],
  events: { emit: () => {} },
  createSession: () => ({ send: async () => "", close: () => {} }),
  registerProvider: () => {},
  getProvider: () => null,
  callTool: async () => ({ content: "" }),
  registerMiddleware: () => {},
};

describe("registryModule", () => {
  it("has correct metadata", () => {
    expect(registryModule.name).toBe("registry");
    expect(registryModule.version).toBe("1.0.0");
    expect(registryModule.description).toContain("tool");
  });

  it("registers a 'tools' CLI command", () => {
    const cmds = registryModule.commands!(stubCtx);
    expect(cmds).toHaveLength(1);
    expect(cmds[0].name()).toBe("tools");
  });

  it("tools command has install, list, remove, and update subcommands", () => {
    const cmds = registryModule.commands!(stubCtx);
    const toolsCmd = cmds[0];
    const subNames = toolsCmd.commands.map((c) => c.name());
    expect(subNames).toContain("install");
    expect(subNames).toContain("list");
    expect(subNames).toContain("remove");
    expect(subNames).toContain("update");
  });

  it("does not register tools or routes", () => {
    expect(registryModule.tools).toBeUndefined();
    expect(registryModule.routes).toBeUndefined();
  });

  it("has no dependencies", () => {
    expect(registryModule.dependencies).toBeUndefined();
  });
});
