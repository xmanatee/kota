import { describe, expect, it } from "vitest";
import { ExtensionStorage } from "../extension-storage.js";
import type { ExtensionContext } from "../extension-types.js";
import webModule from "./web.js";

const stubCtx: ExtensionContext = {
  cwd: "/tmp/test",
  verbose: false,
  config: {} as ExtensionContext["config"],
  storage: new ExtensionStorage("/tmp/test", "web"),
  registerGroup: () => {},
  getRoutes: () => [],
  getContributedWorkflows: () => [],
  getContributedChannels: () => [],
  getExtensionConfig: () => undefined,
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
