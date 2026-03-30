import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "../event-bus.js";
import { ExtensionStorage } from "../extension-storage.js";
import type { ExtensionContext } from "../extension-types.js";
import { callTelegramApi } from "../telegram-client.js";
import telegramModule from "./telegram.js";

vi.mock("../telegram-client.js", () => ({
  callTelegramApi: vi.fn(),
}));

const mockedCallTelegramApi = vi.mocked(callTelegramApi);

function makeStubCtx(bus?: EventBus): ExtensionContext {
  const b = bus ?? new EventBus();
  return {
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
    events: {
      emit: (event, payload) => b.emit(event, payload as never),
      subscribe: (event, handler) => b.on(event, handler as never),
    },
    createSession: () => ({ send: async () => "", close: () => {} }),
    registerProvider: () => {},
    getProvider: () => null,
    callTool: async () => ({ content: "" }),
    registerMiddleware: () => {},
  };
}

describe("telegramModule", () => {
  it("has correct metadata", () => {
    expect(telegramModule.name).toBe("telegram");
    expect(telegramModule.version).toBe("1.0.0");
    expect(telegramModule.description).toContain("Telegram");
  });

  it("registers a 'telegram' CLI command", () => {
    const cmds = telegramModule.commands!(makeStubCtx());
    expect(cmds).toHaveLength(1);
    expect(cmds[0].name()).toBe("telegram");
  });

  it("telegram command has expected options", () => {
    const cmds = telegramModule.commands!(makeStubCtx());
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

describe("telegramModule notifications via onLoad", () => {
  const FAKE_TOKEN = "bot-token-test";
  const FAKE_CHAT_ID = "123456789";

  beforeEach(() => {
    mockedCallTelegramApi.mockReset();
    mockedCallTelegramApi.mockResolvedValue({ ok: true, result: {} } as never);
    process.env.TELEGRAM_BOT_TOKEN = FAKE_TOKEN;
    process.env.TELEGRAM_ALERT_CHAT_ID = FAKE_CHAT_ID;
  });

  afterEach(async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_ALERT_CHAT_ID;
    await telegramModule.onUnload?.();
  });

  it("sends Telegram message on workflow.failure.alert", async () => {
    const bus = new EventBus();
    telegramModule.onLoad!(makeStubCtx(bus));
    bus.emit("workflow.failure.alert", {
      workflow: "builder",
      runId: "run-abc",
      status: "failed",
      durationMs: 5000,
      errorSummary: "",
      text: "Workflow failed: *builder*",
    });
    await Promise.resolve();
    expect(mockedCallTelegramApi).toHaveBeenCalledWith(
      FAKE_TOKEN,
      "sendMessage",
      expect.objectContaining({ chat_id: FAKE_CHAT_ID, text: "Workflow failed: *builder*" }),
    );
  });

  it("sends Telegram message on workflow.budget.exceeded", async () => {
    const bus = new EventBus();
    telegramModule.onLoad!(makeStubCtx(bus));
    bus.emit("workflow.budget.exceeded", {
      dailySpend: 30,
      budget: 25,
      text: "Daily cost budget reached.",
    });
    await Promise.resolve();
    expect(mockedCallTelegramApi).toHaveBeenCalledWith(
      FAKE_TOKEN,
      "sendMessage",
      expect.objectContaining({ chat_id: FAKE_CHAT_ID, text: "Daily cost budget reached." }),
    );
  });

  it("sends Telegram message on workflow.attention.digest", async () => {
    const bus = new EventBus();
    telegramModule.onLoad!(makeStubCtx(bus));
    bus.emit("workflow.attention.digest", {
      items: [{ label: "Builder failure streak", detail: "3 consecutive failures" }],
      text: "Attention digest (1 item):\n• *Builder failure streak*: 3 consecutive failures",
    });
    await Promise.resolve();
    expect(mockedCallTelegramApi).toHaveBeenCalledWith(
      FAKE_TOKEN,
      "sendMessage",
      expect.objectContaining({ chat_id: FAKE_CHAT_ID }),
    );
    const body = mockedCallTelegramApi.mock.calls[0][2] as { text: string };
    expect(body.text).toContain("Builder failure streak");
  });

  it("sends Telegram message on workflow.cost.limit.reached", async () => {
    const bus = new EventBus();
    telegramModule.onLoad!(makeStubCtx(bus));
    bus.emit("workflow.cost.limit.reached", {
      totalCost: 55,
      hardLimit: 50,
      text: "Cost circuit breaker tripped.",
      pauseSignalFile: "pause",
    });
    await Promise.resolve();
    expect(mockedCallTelegramApi).toHaveBeenCalledWith(
      FAKE_TOKEN,
      "sendMessage",
      expect.objectContaining({ chat_id: FAKE_CHAT_ID, text: "Cost circuit breaker tripped." }),
    );
  });

  it("sends Telegram message on approval.requested", async () => {
    const bus = new EventBus();
    telegramModule.onLoad!(makeStubCtx(bus));
    bus.emit("approval.requested", {
      id: "abc123",
      tool: "bash",
      risk: "high",
      reason: "Runs shell commands",
      source: "builder",
    });
    await Promise.resolve();
    expect(mockedCallTelegramApi).toHaveBeenCalledWith(
      FAKE_TOKEN,
      "sendMessage",
      expect.objectContaining({ chat_id: FAKE_CHAT_ID }),
    );
    const body = mockedCallTelegramApi.mock.calls[0][2] as { text: string };
    expect(body.text).toContain("bash");
    expect(body.text).toContain("kota approval approve abc123");
    expect(body.text).toContain("kota approval reject abc123");
  });

  it("does not send Telegram message when credentials are missing", async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    const bus = new EventBus();
    telegramModule.onLoad!(makeStubCtx(bus));
    bus.emit("workflow.failure.alert", {
      workflow: "builder",
      runId: "run-abc",
      status: "failed",
      durationMs: 5000,
      errorSummary: "",
      text: "alert",
    });
    await Promise.resolve();
    expect(mockedCallTelegramApi).not.toHaveBeenCalled();
  });

  it("unloads cleanly and stops receiving events", async () => {
    const bus = new EventBus();
    telegramModule.onLoad!(makeStubCtx(bus));
    await telegramModule.onUnload?.();
    bus.emit("workflow.failure.alert", {
      workflow: "builder",
      runId: "run-abc",
      status: "failed",
      durationMs: 5000,
      errorSummary: "",
      text: "alert",
    });
    await Promise.resolve();
    expect(mockedCallTelegramApi).not.toHaveBeenCalled();
  });
});
