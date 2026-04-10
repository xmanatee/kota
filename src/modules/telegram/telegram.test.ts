import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "../../event-bus.js";
import { ModuleStorage } from "../../module-storage.js";
import type { ModuleContext } from "../../module-types.js";
import { resolveModuleChannels } from "../../module-types.js";
import { callTelegramApi } from "./client.js";
import telegramModule from "./index.js";

vi.mock("./client.js", () => ({
  callTelegramApi: vi.fn(),
}));

vi.mock("./approval-callback-poll.js", () => ({
  startApprovalCallbackPoll: vi.fn(() => () => {}),
}));

const mockedCallTelegramApi = vi.mocked(callTelegramApi);

function makeStubCtx(bus?: EventBus): ModuleContext {
  const b = bus ?? new EventBus();
  return {
    cwd: "/tmp/test",
    verbose: false,
    config: {} as ModuleContext["config"],
    storage: new ModuleStorage("/tmp/test", "telegram"),
    registerGroup: () => {},
    getRoutes: () => [],
    getContributedWorkflows: () => [],
    getContributedChannels: () => [],
  getModuleSummaries: () => [],
    getModuleConfig: () => undefined,
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
    registerDynamicStateProvider: () => {},
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
    const channels = telegramModule.channels;
    expect(channels).toBeDefined();
    expect(Array.isArray(channels)).toBe(true);
    expect(channels).toHaveLength(1);
    if (!Array.isArray(channels)) {
      throw new Error("expected telegram channels contribution to be static");
    }
    expect(channels[0].name).toBe("telegram-status");
    expect(channels[0].description).toBeTruthy();
  });

  it("telegram-status channel returns null when env vars are missing", async () => {
    const savedToken = process.env.TELEGRAM_BOT_TOKEN;
    const savedChatId = process.env.TELEGRAM_ALERT_CHAT_ID;
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_ALERT_CHAT_ID;
    try {
      const [channel] = await resolveModuleChannels(telegramModule, makeStubCtx());
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

  it("sends Telegram message with inline keyboard on approval.requested", async () => {
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
    const body = mockedCallTelegramApi.mock.calls[0][2] as {
      text: string;
      reply_markup?: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> };
    };
    expect(body.text).toContain("bash");
    expect(body.text).toContain("kota approval approve abc123");
    expect(body.text).toContain("kota approval reject abc123");
    expect(body.reply_markup?.inline_keyboard[0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ callback_data: "approve:abc123" }),
        expect.objectContaining({ callback_data: "reject:abc123" }),
      ]),
    );
  });

  it("sends Telegram commit message when workflow.build.committed fires and event is opt-in enabled", async () => {
    const bus = new EventBus();
    const ctx = makeStubCtx(bus);
    ctx.getModuleConfig = () => ({ events: ["workflow.build.committed"] } as never);
    telegramModule.onLoad!(ctx);
    bus.emit("workflow.build.committed", {
      runId: "run-abc",
      taskId: "task-foo-bar",
      commitMessage: "Add foo bar support",
      costUsd: 0.42,
      durationMs: 480000,
    });
    await Promise.resolve();
    expect(mockedCallTelegramApi).toHaveBeenCalledOnce();
    const body = mockedCallTelegramApi.mock.calls[0][2] as { text: string };
    expect(body.text).toContain("Add foo bar support");
    expect(body.text).toContain("task-foo-bar");
    expect(body.text).toContain("0.42");
  });

  it("does not send workflow.build.committed when not in opt-in events", async () => {
    const bus = new EventBus();
    telegramModule.onLoad!(makeStubCtx(bus));
    bus.emit("workflow.build.committed", {
      runId: "run-abc",
      taskId: "task-foo-bar",
      commitMessage: "Add foo bar support",
      costUsd: 0.42,
      durationMs: 480000,
    });
    await Promise.resolve();
    expect(mockedCallTelegramApi).not.toHaveBeenCalled();
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

  it("starts approval callback poll on load when credentials are present", async () => {
    const { startApprovalCallbackPoll } = await import("./approval-callback-poll.js");
    const mockStart = vi.mocked(startApprovalCallbackPoll);
    mockStart.mockClear();

    const bus = new EventBus();
    telegramModule.onLoad!(makeStubCtx(bus));

    expect(mockStart).toHaveBeenCalledOnce();
    expect(mockStart).toHaveBeenCalledWith(
      FAKE_TOKEN,
      expect.any(Map),
      expect.any(Object),
    );
  });

  it("does not start approval callback poll when credentials are missing", async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    const { startApprovalCallbackPoll } = await import("./approval-callback-poll.js");
    const mockStart = vi.mocked(startApprovalCallbackPoll);
    mockStart.mockClear();

    const bus = new EventBus();
    telegramModule.onLoad!(makeStubCtx(bus));

    expect(mockStart).not.toHaveBeenCalled();
  });
});
