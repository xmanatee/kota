import { describe, expect, it } from "vitest";
import { ExtensionStorage } from "../extension-storage.js";
import type { ExtensionContext } from "../extension-types.js";
import telegramModule from "./telegram.js";

const stubCtx: ExtensionContext = {
  cwd: "/tmp/test",
  verbose: false,
  config: {} as ExtensionContext["config"],
  storage: new ExtensionStorage("/tmp/test", "telegram"),
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

  it("does not register tools or routes", () => {
    expect(telegramModule.tools).toBeUndefined();
    expect(telegramModule.routes).toBeUndefined();
  });

  it("has no dependencies", () => {
    expect(telegramModule.dependencies).toBeUndefined();
  });

  it("contributes a telegram-status channel", () => {
    expect(telegramModule.channels).toBeDefined();
    expect(telegramModule.channels).toHaveLength(1);
    expect(telegramModule.channels![0].name).toBe("telegram-status");
    expect(telegramModule.channels![0].description).toBeTruthy();
  });

  it("telegram-status channel returns null when env vars are missing", () => {
    const savedToken = process.env.TELEGRAM_BOT_TOKEN;
    const savedChatId = process.env.TELEGRAM_ALERT_CHAT_ID;
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_ALERT_CHAT_ID;
    try {
      const channel = telegramModule.channels![0];
      const adapter = channel.create({
        projectDir: "/tmp",
        log: () => {},
        getWorkflowStatus: () => ({
          runtimeState: { completedRuns: 0, pendingRuns: [], workflows: {} },
          dispatchPaused: false,
          runsDir: "/tmp/.kota/runs",
        }),
      });
      expect(adapter).toBeNull();
    } finally {
      if (savedToken !== undefined) process.env.TELEGRAM_BOT_TOKEN = savedToken;
      if (savedChatId !== undefined) process.env.TELEGRAM_ALERT_CHAT_ID = savedChatId;
    }
  });
});
