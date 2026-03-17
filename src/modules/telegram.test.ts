import { describe, expect, it } from "vitest";
import { ModuleStorage } from "../module-storage.js";
import type { ModuleContext } from "../module-types.js";
import telegramModule from "./telegram.js";

const stubCtx: ModuleContext = {
  cwd: "/tmp/test",
  verbose: false,
  config: {} as ModuleContext["config"],
  storage: new ModuleStorage("/tmp/test", "telegram"),
  registerGroup: () => {},
  getRoutes: () => [],
  getModuleConfig: () => undefined,
  log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  getSecret: () => null,
  listTools: () => [],
  events: { emit: () => {}, on: () => () => {}, once: () => () => {} },
  createSession: () => ({ send: async () => "", close: () => {} }),
};

describe("telegramModule", () => {
  it("has correct metadata", () => {
    expect(telegramModule.name).toBe("telegram");
    expect(telegramModule.version).toBe("1.0.0");
    expect(telegramModule.description).toContain("Telegram");
  });

  it("registers a 'telegram' CLI command", () => {
    const cmds = telegramModule.commands!(stubCtx);
    expect(cmds).toHaveLength(1);
    expect(cmds[0].name()).toBe("telegram");
  });

  it("telegram command has expected options", () => {
    const cmds = telegramModule.commands!(stubCtx);
    const cmd = cmds[0];
    const optNames = cmd.options.map((o) => o.long);
    expect(optNames).toContain("--token");
    expect(optNames).toContain("--model");
    expect(optNames).toContain("--verbose");
    expect(optNames).toContain("--allowed-chats");
  });

  it("does not register tools, routes, or events", () => {
    expect(telegramModule.tools).toBeUndefined();
    expect(telegramModule.routes).toBeUndefined();
    expect(telegramModule.events).toBeUndefined();
  });

  it("has no dependencies", () => {
    expect(telegramModule.dependencies).toBeUndefined();
  });
});
