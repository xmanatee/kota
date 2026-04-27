import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "#core/events/event-bus.js";
import { ModuleStorage } from "#core/modules/module-storage.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import { resolveModuleChannels } from "#core/modules/module-types.js";
import { callTelegramApi } from "./client.js";
import telegramModule from "./index.js";

vi.mock("./client.js", () => ({
  callTelegramApi: vi.fn(),
}));

vi.mock("./callback-poll.js", () => ({
  startCallbackPoll: vi.fn(() => () => {}),
}));

const mockOwnerQueueGet = vi.fn();
vi.mock("#core/daemon/owner-question-queue.js", () => ({
  getOwnerQuestionQueue: () => ({ get: mockOwnerQueueGet }),
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
    getContributedControlRoutes: () => [],
  getModuleSummaries: () => [],
    getModuleConfig: () => undefined,
    log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    getSecret: () => null,
    listTools: () => [],
    events: {
      emit: (event, payload) => b.emit(event, payload as never),
      subscribe: (event, handler) => b.on(event, handler as never),
      listenerCount: (event?: string) => b.listenerCount(event),
    },
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
    client: {} as never,
  };
}

describe("telegramModule", () => {
  it("has correct metadata", () => {
    expect(telegramModule.name).toBe("telegram");
    expect(telegramModule.version).toBe("1.0.0");
    expect(telegramModule.description).toContain("Telegram");
  });

  it("does not register a standalone CLI command", () => {
    expect(telegramModule.commands).toBeUndefined();
  });

  it("does not register tools or routes", () => {
    expect(telegramModule.tools).toBeUndefined();
    expect(telegramModule.routes).toBeUndefined();
  });

  it("declares dependencies", () => {
    expect(telegramModule.dependencies).toEqual([
      "approval-queue",
      "autonomy",
      "history",
      "knowledge",
      "memory",
      "transcription",
    ]);
  });

  it("contributes telegram-status and telegram-interactive channels", async () => {
    const channels = await resolveModuleChannels(telegramModule, makeStubCtx());
    const names = channels.map((c) => c.name);
    expect(names).toContain("telegram-status");
    expect(names).toContain("telegram-interactive");
    expect(channels).toHaveLength(2);
  });

  it("telegram-status channel returns null when env vars are missing", async () => {
    const savedToken = process.env.TELEGRAM_BOT_TOKEN;
    const savedChatId = process.env.TELEGRAM_ALERT_CHAT_ID;
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_ALERT_CHAT_ID;
    try {
      const channels = await resolveModuleChannels(telegramModule, makeStubCtx());
      const channel = channels.find((c) => c.name === "telegram-status");
      if (!channel) throw new Error("telegram-status channel missing");
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

  it("telegram-interactive channel returns null when token is missing", async () => {
    const savedToken = process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_BOT_TOKEN;
    try {
      const channels = await resolveModuleChannels(telegramModule, makeStubCtx());
      const channel = channels.find((c) => c.name === "telegram-interactive");
      if (!channel) throw new Error("telegram-interactive channel missing");
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
    }
  });
});

describe("telegramModule notifications via onLoad", () => {
  const FAKE_TOKEN = "bot-token-test";
  const FAKE_CHAT_ID = "123456789";

  beforeEach(() => {
    mockedCallTelegramApi.mockReset();
    mockedCallTelegramApi.mockResolvedValue({ ok: true, result: {} } as never);
    mockOwnerQueueGet.mockReset();
    mockOwnerQueueGet.mockReturnValue(null);
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

  it("sends Telegram message on workflow.daily.digest", async () => {
    const bus = new EventBus();
    telegramModule.onLoad!(makeStubCtx(bus));
    bus.emit("workflow.daily.digest", {
      windowStartedAt: "2026-04-25T08:00:00.000Z",
      windowEndedAt: "2026-04-26T08:00:00.000Z",
      text: "Daily digest body — 2 commits, 1 explorer addition.",
      quiet: false,
    });
    await Promise.resolve();
    expect(mockedCallTelegramApi).toHaveBeenCalledWith(
      FAKE_TOKEN,
      "sendMessage",
      expect.objectContaining({ chat_id: FAKE_CHAT_ID }),
    );
    const body = mockedCallTelegramApi.mock.calls[0][2] as { text: string };
    expect(body.text).toContain("Daily digest body");
  });

  it("sends Telegram message on owner.question.asked with CLI commands and Dismiss button", async () => {
    const bus = new EventBus();
    telegramModule.onLoad!(makeStubCtx(bus));
    bus.emit("owner.question.asked", {
      id: "oq-xyz",
      question: "Split this migration into two phases?",
      reason: "Risky one-shot migration",
      source: "builder",
    });
    await Promise.resolve();
    expect(mockedCallTelegramApi).toHaveBeenCalledOnce();
    const body = mockedCallTelegramApi.mock.calls[0][2] as {
      text: string;
      reply_markup?: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> };
    };
    expect(body.text).toContain("Owner question");
    expect(body.text).toContain("builder");
    expect(body.text).toContain("Split this migration into two phases?");
    expect(body.text).toContain("Risky one-shot migration");
    expect(body.text).toContain("kota owner-question answer oq-xyz");
    expect(body.text).toContain("kota owner-question dismiss oq-xyz");
    const keyboard = body.reply_markup?.inline_keyboard ?? [];
    expect(keyboard).toEqual([
      [{ text: "Dismiss", callback_data: "dismiss:oq-xyz" }],
    ]);
  });

  it("sends owner.question.asked with per-answer buttons when proposedAnswers is set", async () => {
    mockOwnerQueueGet.mockReturnValue({
      id: "oq-abc",
      question: "Pick cluster region",
      reason: "multiregion rollout",
      source: "builder",
      status: "pending",
      proposedAnswers: ["us-east-1", "us-west-2", "eu-central-1"],
    });

    const bus = new EventBus();
    telegramModule.onLoad!(makeStubCtx(bus));
    bus.emit("owner.question.asked", {
      id: "oq-abc",
      question: "Pick cluster region",
      reason: "multiregion rollout",
      source: "builder",
    });
    await Promise.resolve();
    const body = mockedCallTelegramApi.mock.calls[0][2] as {
      reply_markup?: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> };
    };
    expect(mockOwnerQueueGet).toHaveBeenCalledWith("oq-abc");
    const keyboard = body.reply_markup?.inline_keyboard ?? [];
    expect(keyboard).toEqual([
      [
        { text: "us-east-1", callback_data: "answer:oq-abc:0" },
        { text: "us-west-2", callback_data: "answer:oq-abc:1" },
      ],
      [{ text: "eu-central-1", callback_data: "answer:oq-abc:2" }],
      [{ text: "Dismiss", callback_data: "dismiss:oq-abc" }],
    ]);
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

  it("starts unified callback poll on load when credentials are present", async () => {
    const { startCallbackPoll } = await import("./callback-poll.js");
    const mockStart = vi.mocked(startCallbackPoll);
    mockStart.mockClear();

    const bus = new EventBus();
    telegramModule.onLoad!(makeStubCtx(bus));

    expect(mockStart).toHaveBeenCalledOnce();
    expect(mockStart).toHaveBeenCalledWith(
      FAKE_TOKEN,
      expect.any(Map),
      expect.any(Map),
      expect.any(Object),
    );
  });

  it("does not start callback poll when credentials are missing", async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    const { startCallbackPoll } = await import("./callback-poll.js");
    const mockStart = vi.mocked(startCallbackPoll);
    mockStart.mockClear();

    const bus = new EventBus();
    telegramModule.onLoad!(makeStubCtx(bus));

    expect(mockStart).not.toHaveBeenCalled();
  });
});
