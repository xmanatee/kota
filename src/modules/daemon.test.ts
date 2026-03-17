import { describe, expect, it } from "vitest";
import { ModuleStorage } from "../module-storage.js";
import type { ModuleContext } from "../module-types.js";
import daemonModule from "./daemon.js";

const stubCtx: ModuleContext = {
  cwd: "/tmp/test",
  verbose: false,
  config: {} as ModuleContext["config"],
  storage: new ModuleStorage("/tmp/test", "daemon"),
  registerGroup: () => {},
  getRoutes: () => [],
  getModuleConfig: () => undefined,
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
    expect(optNames).toContain("--idle-prompt");
    expect(optNames).toContain("--idle-cooldown");
    expect(optNames).toContain("--poll-interval");
    expect(optNames).toContain("--no-restart");
  });

  it("does not register tools, routes, or events", () => {
    expect(daemonModule.tools).toBeUndefined();
    expect(daemonModule.routes).toBeUndefined();
    expect(daemonModule.events).toBeUndefined();
  });

  it("has no dependencies", () => {
    expect(daemonModule.dependencies).toBeUndefined();
  });
});
