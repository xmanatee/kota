import { describe, expect, it } from "vitest";
import { ExtensionStorage } from "../extension-storage.js";
import type { ExtensionContext } from "../extension-types.js";
import daemonModule, { buildDaemonChildArgs } from "./daemon.js";

const stubCtx: ExtensionContext = {
  cwd: "/tmp/test",
  verbose: false,
  config: {} as ExtensionContext["config"],
  storage: new ExtensionStorage("/tmp/test", "daemon"),
  registerGroup: () => {},
  getRoutes: () => [],
  getWorkflows: () => [],
  getModuleConfig: () => undefined,
  log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  getSecret: () => null,
  listTools: () => [],
  events: { emit: () => {}, on: () => () => {}, once: () => () => {} },
  createSession: () => ({ send: async () => "", close: () => {} }),
  registerProvider: () => {},
  getProvider: () => null,
  callTool: async () => ({ content: "" }),
  registerMiddleware: () => {},
};

describe("daemonModule", () => {
  it("has correct metadata", () => {
    expect(daemonModule.name).toBe("daemon");
    expect(daemonModule.version).toBe("1.0.0");
    expect(daemonModule.description).toContain("Long-running");
  });

  it("registers a 'daemon' CLI command", () => {
    const cmds = daemonModule.commands!(stubCtx);
    expect(cmds).toHaveLength(1);
    expect(cmds[0].name()).toBe("daemon");
  });

  it("daemon command has expected options", () => {
    const cmds = daemonModule.commands!(stubCtx);
    const cmd = cmds[0];
    const optNames = cmd.options.map((o) => o.long);
    expect(optNames).toContain("--model");
    expect(optNames).toContain("--verbose");
    expect(optNames).toContain("--idle-interval");
    expect(optNames).toContain("--poll-interval");
  });

  it("does not register tools, routes, or events", () => {
    expect(daemonModule.tools).toBeUndefined();
    expect(daemonModule.routes).toBeUndefined();
    expect(daemonModule.events).toBeUndefined();
  });

  it("has no dependencies", () => {
    expect(daemonModule.dependencies).toBeUndefined();
  });

  it("builds child daemon args from parsed options", () => {
    const args = buildDaemonChildArgs({
      model: "claude-sonnet-4-6",
      verbose: true,
      idleInterval: "5",
      pollInterval: "30",
    });

    expect(args).toContain("daemon");
    expect(args).toContain("--idle-interval");
    expect(args).toContain("5");
    expect(args).toContain("--poll-interval");
    expect(args).toContain("30");
    expect(args).toContain("--model");
    expect(args).toContain("claude-sonnet-4-6");
    expect(args).toContain("--verbose");
  });
});
