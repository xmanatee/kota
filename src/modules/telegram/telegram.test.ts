import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type AgentHarness,
  resolveAgentHarness,
} from "#core/agent-harness/index.js";
import type { CapabilityReadinessSource } from "#core/daemon/capability-readiness.js";
import type { PendingOwnerQuestion } from "#core/daemon/owner-question-queue.js";
import type { ConfiguredProject } from "#core/daemon/scope-registry.js";
import { EventBus } from "#core/events/event-bus.js";
import { ModuleStorage } from "#core/modules/module-storage.js";
import type { ModuleRuntimeContext } from "#core/modules/module-types.js";
import { resolveModuleChannels } from "#core/modules/module-types.js";
import { makeStubEventProxy } from "#core/modules/testing/index.js";
import type { KotaClient } from "#core/server/kota-client.js";
import { callTelegramApi, TelegramApiError } from "./client.js";
import telegramModule, {
  TELEGRAM_INTERACTIVE_BACKEND_CAPABILITY_ID,
} from "./index.js";

vi.mock("./client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./client.js")>();
  return {
    ...actual,
    callTelegramApi: vi.fn(),
  };
});

vi.mock("./callback-poll.js", () => ({
  createTelegramCallbackHandler: vi.fn(() => async () => false),
  startCallbackPoll: vi.fn(() => () => {}),
}));

function makeTestHarness(name: string): AgentHarness {
  return {
    name,
    description: `${name} test harness`,
    supportsMultiTurn: true,
    supportedHookKinds: ["preRun", "postRun"],
    askOwnerToolName: null,
    emitsAgentMessageStream: false,
    toolControl: name === "codex" ? "native" : "kota",
    unsupportedRunOptions: [],
    async run() {
      return {
        text: "ok",
        streamedText: "ok",
        turns: 1,
        isError: false,
      };
    },
  };
}

vi.mock("#core/agent-harness/index.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("#core/agent-harness/index.js")>();
  return {
    ...actual,
    resolveAgentHarness: vi.fn((name: string) => makeTestHarness(name)),
  };
});

const mockOwnerQueueGet = vi.fn();
vi.mock("#core/daemon/owner-question-queue.js", () => ({
  getOwnerQuestionQueue: () => ({ get: mockOwnerQueueGet }),
}));

const mockedCallTelegramApi = vi.mocked(callTelegramApi);
const mockedResolveAgentHarness = vi.mocked(resolveAgentHarness);

async function flushAsyncNotifications(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

const TEST_PROJECT: ConfiguredProject = {
  projectId: "test-project",
  projectDir: "/tmp/test",
  displayName: "KOTA",
};

function makeChannelStartContext(
  overrides: { reportFailure?: (message: string) => void } = {},
) {
  const runtime = {
    project: TEST_PROJECT,
    scheduler: { count: () => 0 },
  } as never;
  return {
    projectDir: "/tmp",
    defaultProjectRuntime: runtime,
    getProjectRuntime: () => runtime,
    log: () => {},
    reportFailure: overrides.reportFailure ?? (() => {}),
    getWorkflowStatus: () => ({
      runtimeState: { completedRuns: 0, pendingRuns: [], workflows: {} },
      dispatchPaused: false,
      runsDir: "/tmp/.kota/runs",
    }),
  };
}

function makeStubClient(
  overrides: Partial<KotaClient> = {},
): KotaClient {
  const client = {
    projects: {
      list: vi.fn(async () => ({
        ok: true as const,
        defaultProjectId: TEST_PROJECT.projectId,
        activeProjectId: null,
        projects: [TEST_PROJECT],
      })),
      use: vi.fn(),
    },
    ownerQuestions: {
      list: vi.fn(async () => ({ questions: [] })),
      answer: vi.fn(),
      dismiss: vi.fn(),
    },
  } as Partial<KotaClient>;
  client.forProject = vi.fn(() => client as KotaClient);
  Object.assign(client, overrides);
  return client as KotaClient;
}

function makeStubCtx(
  bus?: EventBus,
  client: KotaClient = makeStubClient(),
  config: ModuleRuntimeContext["config"] = {} as ModuleRuntimeContext["config"],
): ModuleRuntimeContext {
  const b = bus ?? new EventBus();
  return {
    cwd: "/tmp/test",
    verbose: false,
    config,
    storage: new ModuleStorage("/tmp/test", "telegram"),
    registerGroup: () => {},
    getRoutes: () => [],
    getContributedWorkflows: () => [],
    getContributedChannels: () => [],
    getContributedControlRoutes: () => [],
    getModuleSummaries: () => [],
    getModuleConfig: () => undefined,
    log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    getSecret: (key) => process.env[key] ?? null,
    listTools: () => [],
    events: makeStubEventProxy(b),
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
    client,
  };
}

describe("telegramModule", () => {
  beforeEach(() => {
    mockedResolveAgentHarness.mockReset();
    mockedResolveAgentHarness.mockImplementation((name: string) =>
      makeTestHarness(name),
    );
  });

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
      "answer",
      "approval-queue",
      "autonomy",
      "capture",
      "daemon-ops",
      "history",
      "inbound-signals",
      "knowledge",
      "memory",
      "model-clients",
      "recall",
      "repo-tasks",
      "retract",
      "secrets",
      "transcription",
    ]);
  });

  it("declares separate setup for bot credentials and interactive backend readiness", () => {
    const setupRequirements = telegramModule.setupRequirements;
    if (!setupRequirements || typeof setupRequirements === "function") {
      throw new Error("telegram setup requirements must be static");
    }

    const credentialRequirement = setupRequirements.find((req) =>
      req.id === "bot-credentials"
    );
    const backendRequirement = setupRequirements.find((req) =>
      req.id === "interactive-model-backend"
    );
    expect(credentialRequirement?.kind).toBe("secret");
    expect(backendRequirement).toMatchObject({
      kind: "capability",
      capabilityIds: [TELEGRAM_INTERACTIVE_BACKEND_CAPABILITY_ID],
    });
    const manifest = telegramModule.manifest;
    if (!manifest || typeof manifest === "function") {
      throw new Error("telegram manifest must be static");
    }
    const interactiveCapability = manifest.capabilities.find(
      (capability) => capability.id === "telegram.interactive",
    );
    expect(interactiveCapability?.setupRequirementIds).toEqual([
      "bot-credentials",
      "interactive-model-backend",
    ]);
  });

  it("reports the default Codex backend as ready through setup capability readiness", async () => {
    const readiness = { source: null as CapabilityReadinessSource | null };
    const ctx = makeStubCtx(
      undefined,
      makeStubClient(),
      {
        model: "gpt-5.5",
        serve: { defaultAutonomyMode: "passive" },
      } as ModuleRuntimeContext["config"],
    );
    ctx.registerProvider = <T,>(_token: unknown, provider: T): void => {
      readiness.source = provider as unknown as CapabilityReadinessSource;
    };

    telegramModule.onLoad!(ctx);
    try {
      const source = readiness.source;
      if (!source) throw new Error("readiness source not registered");
      const reports = await source.probe();
      expect(reports).toEqual([
        expect.objectContaining({
          id: TELEGRAM_INTERACTIVE_BACKEND_CAPABILITY_ID,
          status: "ready",
          reason: "harness_ready",
          message: expect.stringContaining("codex"),
        }),
      ]);
    } finally {
      await telegramModule.onUnload?.();
    }
  });

  it("reports provider-backed backend setup as unavailable when its API key is missing", async () => {
    const savedOpenAiKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    const readiness = { source: null as CapabilityReadinessSource | null };
    const ctx = makeStubCtx(
      undefined,
      makeStubClient(),
      {
        model: "openai/gpt-5.5",
        serve: { defaultAutonomyMode: "supervised" },
      } as ModuleRuntimeContext["config"],
    );
    ctx.registerProvider = <T,>(_token: unknown, provider: T): void => {
      readiness.source = provider as unknown as CapabilityReadinessSource;
    };

    try {
      telegramModule.onLoad!(ctx);
      const source = readiness.source;
      if (!source) throw new Error("readiness source not registered");
      const reports = await source.probe();
      expect(reports).toEqual([
        expect.objectContaining({
          id: TELEGRAM_INTERACTIVE_BACKEND_CAPABILITY_ID,
          status: "unavailable",
          reason: "interactive_backend_unavailable",
          message: expect.stringContaining("OPENAI_API_KEY"),
        }),
      ]);
    } finally {
      await telegramModule.onUnload?.();
      if (savedOpenAiKey !== undefined) process.env.OPENAI_API_KEY = savedOpenAiKey;
      else delete process.env.OPENAI_API_KEY;
    }
  });

  it("contributes telegram-status and telegram-interactive channels", async () => {
    const channels = await resolveModuleChannels(telegramModule, makeStubCtx());
    const names = channels.map((c) => c.name);
    expect(names).toContain("telegram-status");
    expect(names).toContain("telegram-interactive");
    expect(channels).toHaveLength(2);
  });

  it("telegram-status channel reports unavailable when env vars are missing", async () => {
    const savedToken = process.env.TELEGRAM_BOT_TOKEN;
    const savedChatId = process.env.TELEGRAM_ALERT_CHAT_ID;
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_ALERT_CHAT_ID;
    try {
      const channels = await resolveModuleChannels(telegramModule, makeStubCtx());
      const channel = channels.find((c) => c.name === "telegram-status");
      if (!channel) throw new Error("telegram-status channel missing");
      const result = channel.create(makeChannelStartContext());
      expect(result.status).toBe("unavailable");
      if (result.status === "unavailable") {
        expect(result.reason).toContain("TELEGRAM_BOT_TOKEN");
        expect(result.reason).toContain("TELEGRAM_ALERT_CHAT_ID");
      }
    } finally {
      if (savedToken !== undefined) process.env.TELEGRAM_BOT_TOKEN = savedToken;
      if (savedChatId !== undefined) process.env.TELEGRAM_ALERT_CHAT_ID = savedChatId;
    }
  });

  it("telegram-interactive channel reports unavailable when token is missing", async () => {
    const savedToken = process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_BOT_TOKEN;
    try {
      const channels = await resolveModuleChannels(telegramModule, makeStubCtx());
      const channel = channels.find((c) => c.name === "telegram-interactive");
      if (!channel) throw new Error("telegram-interactive channel missing");
      const result = channel.create(makeChannelStartContext());
      expect(result.status).toBe("unavailable");
      if (result.status === "unavailable") {
        expect(result.reason).toContain("TELEGRAM_BOT_TOKEN");
      }
    } finally {
      if (savedToken !== undefined) process.env.TELEGRAM_BOT_TOKEN = savedToken;
    }
  });

  it("telegram-interactive channel starts with the default Codex preset without a model provider", async () => {
    const savedToken = process.env.TELEGRAM_BOT_TOKEN;
    const savedChatId = process.env.TELEGRAM_ALERT_CHAT_ID;
    process.env.TELEGRAM_BOT_TOKEN = "bot-token-test";
    process.env.TELEGRAM_ALERT_CHAT_ID = "123456789";
    try {
      const channels = await resolveModuleChannels(
        telegramModule,
        makeStubCtx(
          undefined,
          makeStubClient(),
          {
            model: "gpt-5.5",
            serve: { defaultAutonomyMode: "passive" },
          } as ModuleRuntimeContext["config"],
        ),
      );
      const channel = channels.find((c) => c.name === "telegram-interactive");
      if (!channel) throw new Error("telegram-interactive channel missing");
      const result = channel.create(makeChannelStartContext());
      expect(result.status).toBe("started");
      expect(mockedResolveAgentHarness).toHaveBeenCalledWith("codex");
    } finally {
      if (savedToken !== undefined) process.env.TELEGRAM_BOT_TOKEN = savedToken;
      else delete process.env.TELEGRAM_BOT_TOKEN;
      if (savedChatId !== undefined) process.env.TELEGRAM_ALERT_CHAT_ID = savedChatId;
      else delete process.env.TELEGRAM_ALERT_CHAT_ID;
    }
  });

  it("telegram-interactive channel reports unavailable when provider API key is missing", async () => {
    const savedToken = process.env.TELEGRAM_BOT_TOKEN;
    const savedChatId = process.env.TELEGRAM_ALERT_CHAT_ID;
    const savedOpenAiKey = process.env.OPENAI_API_KEY;
    process.env.TELEGRAM_BOT_TOKEN = "bot-token-test";
    process.env.TELEGRAM_ALERT_CHAT_ID = "123456789";
    delete process.env.OPENAI_API_KEY;
    try {
      const channels = await resolveModuleChannels(
        telegramModule,
        makeStubCtx(
          undefined,
          makeStubClient(),
          {
            model: "gpt-5.5",
            modelProvider: { type: "openai" },
            serve: { defaultAutonomyMode: "passive" },
          } as ModuleRuntimeContext["config"],
        ),
      );
      const channel = channels.find((c) => c.name === "telegram-interactive");
      if (!channel) throw new Error("telegram-interactive channel missing");
      const result = channel.create(makeChannelStartContext());
      expect(result.status).toBe("unavailable");
      if (result.status === "unavailable") {
        expect(result.reason).toContain("OPENAI_API_KEY");
      }
    } finally {
      if (savedToken !== undefined) process.env.TELEGRAM_BOT_TOKEN = savedToken;
      else delete process.env.TELEGRAM_BOT_TOKEN;
      if (savedChatId !== undefined) process.env.TELEGRAM_ALERT_CHAT_ID = savedChatId;
      else delete process.env.TELEGRAM_ALERT_CHAT_ID;
      if (savedOpenAiKey !== undefined) process.env.OPENAI_API_KEY = savedOpenAiKey;
      else delete process.env.OPENAI_API_KEY;
    }
  });

  it("telegram-interactive channel keeps provider/model notation on the regular session path", async () => {
    const savedToken = process.env.TELEGRAM_BOT_TOKEN;
    const savedChatId = process.env.TELEGRAM_ALERT_CHAT_ID;
    const savedOpenAiKey = process.env.OPENAI_API_KEY;
    const savedOpenRouterKey = process.env.OPENROUTER_API_KEY;
    process.env.TELEGRAM_BOT_TOKEN = "bot-token-test";
    process.env.TELEGRAM_ALERT_CHAT_ID = "123456789";
    delete process.env.OPENAI_API_KEY;
    process.env.OPENROUTER_API_KEY = "sk-test";
    try {
      const channels = await resolveModuleChannels(
        telegramModule,
        makeStubCtx(
          undefined,
          makeStubClient(),
          {
            defaultAgentHarness: "openai-tools",
            model: "openrouter/openrouter/auto",
            serve: { defaultAutonomyMode: "supervised" },
          } as ModuleRuntimeContext["config"],
        ),
      );
      const channel = channels.find((c) => c.name === "telegram-interactive");
      if (!channel) throw new Error("telegram-interactive channel missing");
      const result = channel.create(makeChannelStartContext());
      expect(result.status).toBe("started");
      expect(mockedResolveAgentHarness).not.toHaveBeenCalled();
    } finally {
      if (savedToken !== undefined) process.env.TELEGRAM_BOT_TOKEN = savedToken;
      else delete process.env.TELEGRAM_BOT_TOKEN;
      if (savedChatId !== undefined) process.env.TELEGRAM_ALERT_CHAT_ID = savedChatId;
      else delete process.env.TELEGRAM_ALERT_CHAT_ID;
      if (savedOpenAiKey !== undefined) process.env.OPENAI_API_KEY = savedOpenAiKey;
      else delete process.env.OPENAI_API_KEY;
      if (savedOpenRouterKey !== undefined) process.env.OPENROUTER_API_KEY = savedOpenRouterKey;
      else delete process.env.OPENROUTER_API_KEY;
    }
  });

  it("telegram-interactive channel validates provider/model notation before starting", async () => {
    const savedToken = process.env.TELEGRAM_BOT_TOKEN;
    const savedChatId = process.env.TELEGRAM_ALERT_CHAT_ID;
    const savedOpenAiKey = process.env.OPENAI_API_KEY;
    process.env.TELEGRAM_BOT_TOKEN = "bot-token-test";
    process.env.TELEGRAM_ALERT_CHAT_ID = "123456789";
    delete process.env.OPENAI_API_KEY;
    try {
      const channels = await resolveModuleChannels(
        telegramModule,
        makeStubCtx(
          undefined,
          makeStubClient(),
          {
            model: "openai/gpt-5.5",
            serve: { defaultAutonomyMode: "supervised" },
          } as ModuleRuntimeContext["config"],
        ),
      );
      const channel = channels.find((c) => c.name === "telegram-interactive");
      if (!channel) throw new Error("telegram-interactive channel missing");
      const result = channel.create(makeChannelStartContext());
      expect(result.status).toBe("unavailable");
      if (result.status === "unavailable") {
        expect(result.reason).toContain("OPENAI_API_KEY");
      }
      expect(mockedResolveAgentHarness).not.toHaveBeenCalled();
    } finally {
      if (savedToken !== undefined) process.env.TELEGRAM_BOT_TOKEN = savedToken;
      else delete process.env.TELEGRAM_BOT_TOKEN;
      if (savedChatId !== undefined) process.env.TELEGRAM_ALERT_CHAT_ID = savedChatId;
      else delete process.env.TELEGRAM_ALERT_CHAT_ID;
      if (savedOpenAiKey !== undefined) process.env.OPENAI_API_KEY = savedOpenAiKey;
      else delete process.env.OPENAI_API_KEY;
    }
  });

  it("telegram-status channel reports unavailable when KotaClient is unresolved", async () => {
    const savedToken = process.env.TELEGRAM_BOT_TOKEN;
    const savedChatId = process.env.TELEGRAM_ALERT_CHAT_ID;
    process.env.TELEGRAM_BOT_TOKEN = "bot-token-test";
    process.env.TELEGRAM_ALERT_CHAT_ID = "123456789";
    try {
      const ctx = makeStubCtx();
      Object.defineProperty(ctx, "client", {
        get() {
          throw new Error("No active KotaClient resolved.");
        },
      });
      const channels = await resolveModuleChannels(telegramModule, ctx);
      const channel = channels.find((c) => c.name === "telegram-status");
      if (!channel) throw new Error("telegram-status channel missing");
      const result = channel.create(makeChannelStartContext());
      expect(result.status).toBe("unavailable");
      if (result.status === "unavailable") {
        expect(result.reason).toContain("KotaClient");
      }
    } finally {
      if (savedToken !== undefined) process.env.TELEGRAM_BOT_TOKEN = savedToken;
      else delete process.env.TELEGRAM_BOT_TOKEN;
      if (savedChatId !== undefined) process.env.TELEGRAM_ALERT_CHAT_ID = savedChatId;
      else delete process.env.TELEGRAM_ALERT_CHAT_ID;
    }
  });

  it("telegram-status channel does not start a competing Bot API poller", async () => {
    const savedToken = process.env.TELEGRAM_BOT_TOKEN;
    const savedChatId = process.env.TELEGRAM_ALERT_CHAT_ID;
    process.env.TELEGRAM_BOT_TOKEN = "bot-token-test";
    process.env.TELEGRAM_ALERT_CHAT_ID = "123456789";
    mockedCallTelegramApi.mockReset();
    try {
      const channels = await resolveModuleChannels(telegramModule, makeStubCtx());
      const channel = channels.find((c) => c.name === "telegram-status");
      if (!channel) throw new Error("telegram-status channel missing");
      const result = channel.create(makeChannelStartContext());
      expect(result.status).toBe("started");
      if (result.status !== "started") return;

      await result.adapter.start();
      expect(mockedCallTelegramApi).not.toHaveBeenCalled();
      await result.adapter.stop();
    } finally {
      if (savedToken !== undefined) process.env.TELEGRAM_BOT_TOKEN = savedToken;
      else delete process.env.TELEGRAM_BOT_TOKEN;
      if (savedChatId !== undefined) process.env.TELEGRAM_ALERT_CHAT_ID = savedChatId;
      else delete process.env.TELEGRAM_ALERT_CHAT_ID;
    }
  });

  it("emits one deduped health signal when Telegram reports getUpdates conflicts", async () => {
    const savedToken = process.env.TELEGRAM_BOT_TOKEN;
    const savedChatId = process.env.TELEGRAM_ALERT_CHAT_ID;
    process.env.TELEGRAM_BOT_TOKEN = "bot-token-test";
    process.env.TELEGRAM_ALERT_CHAT_ID = "123456789";
    mockedCallTelegramApi.mockReset();
    mockedCallTelegramApi.mockImplementation(async (_token, method) => {
      if (method === "getMe") {
        return { id: 1, first_name: "TestBot", username: "test_bot" } as never;
      }
      if (method === "getUpdates") {
        throw new TelegramApiError(
          "getUpdates",
          "Conflict: terminated by other getUpdates request; make sure that only one bot instance is running",
        );
      }
      return {} as never;
    });

    const bus = new EventBus();
    const envelopes: Array<{ type: string; payload: Record<string, unknown> }> = [];
    bus.on("*", (envelope) => {
      envelopes.push({
        type: envelope.type,
        payload: envelope.payload,
      });
    });
    const failures: string[] = [];

    try {
      const channels = await resolveModuleChannels(
        telegramModule,
        makeStubCtx(
          bus,
          makeStubClient(),
          {
            serve: { defaultAutonomyMode: "passive" },
          } as ModuleRuntimeContext["config"],
        ),
      );
      const channel = channels.find((c) => c.name === "telegram-interactive");
      if (!channel) throw new Error("telegram-interactive channel missing");
      const startContext = makeChannelStartContext({
        reportFailure: (message: string) => {
          failures.push(message);
        },
      });
      const result = channel.create(startContext);
      expect(result.status).toBe("started");
      if (result.status !== "started") return;

      await result.adapter.start();
      await flushAsyncNotifications();
      await result.adapter.start();
      await flushAsyncNotifications();
      await result.adapter.stop();

      expect(failures).toHaveLength(2);
      expect(failures[0]).toContain("getUpdates conflict");
      const healthSignals = envelopes.filter((entry) =>
        entry.type === "autonomy.health.signal"
      );
      expect(healthSignals).toHaveLength(1);
      expect(healthSignals[0]?.payload).toMatchObject({
        projectId: TEST_PROJECT.projectId,
        scopeId: TEST_PROJECT.projectId,
        severity: "warning",
        actionability: "external-service",
        dedupeKey: "module:telegram:getupdates-conflict",
      });
    } finally {
      if (savedToken !== undefined) process.env.TELEGRAM_BOT_TOKEN = savedToken;
      else delete process.env.TELEGRAM_BOT_TOKEN;
      if (savedChatId !== undefined) process.env.TELEGRAM_ALERT_CHAT_ID = savedChatId;
      else delete process.env.TELEGRAM_ALERT_CHAT_ID;
      await telegramModule.onUnload?.();
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
    await flushAsyncNotifications();
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
    await flushAsyncNotifications();
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
    await flushAsyncNotifications();
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
      projectId: TEST_PROJECT.projectId,
      id: "oq-xyz",
      question: "Split this migration into two phases?",
      reason: "Risky one-shot migration",
      source: "builder",
      context: "The migration touches the queue schema and notification transport.",
      answerBehavior: "workflow-resume",
      origin: {
        kind: "workflow",
        workflowName: "builder",
        runId: "run-telegram",
        stepId: "ask-owner",
        taskId: "task-migration",
      },
      proposedAnswers: [],
      timeoutMs: 600_000,
      defaultResolution: "dismiss",
      defaultAnswer: null,
    });
    await flushAsyncNotifications();
    expect(mockedCallTelegramApi).toHaveBeenCalledOnce();
    const body = mockedCallTelegramApi.mock.calls[0][2] as {
      text: string;
      reply_markup?: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> };
    };
    expect(body.text).toContain("Owner question");
    expect(body.text).toContain("builder");
    expect(body.text).toContain("Split this migration into two phases?");
    expect(body.text).toContain("Risky one-shot migration");
    expect(body.text).toContain("The migration touches the queue schema");
    expect(body.text).toContain("Workflow: builder");
    expect(body.text).toContain("run-telegram");
    expect(body.text).toContain("task-migration");
    expect(body.text).toContain("Answer resumes the waiting workflow");
    expect(body.text).toContain("kota owner-question show oq-xyz");
    expect(body.text).toContain("kota owner-question answer oq-xyz");
    expect(body.text).toContain("kota owner-question dismiss oq-xyz");
    const keyboard = body.reply_markup?.inline_keyboard ?? [];
    expect(keyboard).toEqual([
      [{ text: "Dismiss", callback_data: "dismiss:oq-xyz" }],
    ]);
  });

  it("sends owner.question.asked with per-answer buttons when proposedAnswers is set", async () => {
    const ownerQuestion: PendingOwnerQuestion = {
      id: "oq-abc",
      seq: 1,
      context: "test",
      question: "Pick cluster region",
      reason: "multiregion rollout",
      source: "builder",
      answerBehavior: "workflow-resume",
      origin: {
        kind: "workflow",
        workflowName: "builder",
        runId: "run-telegram",
        stepId: "ask-owner",
        taskId: "task-region",
      },
      createdAt: "2026-05-14T00:00:00.000Z",
      status: "pending",
      proposedAnswers: ["us-east-1", "us-west-2", "eu-central-1"],
    };
    const ownerQuestionsList = vi.fn(async () => ({
      questions: [ownerQuestion],
    }));

    const bus = new EventBus();
    telegramModule.onLoad!(
      makeStubCtx(
        bus,
        makeStubClient({
          ownerQuestions: {
            list: ownerQuestionsList,
            answer: vi.fn(),
            dismiss: vi.fn(),
          },
        } as Partial<KotaClient>),
      ),
    );
    bus.emit("owner.question.asked", {
      projectId: TEST_PROJECT.projectId,
      id: "oq-abc",
      question: "Pick cluster region",
      reason: "multiregion rollout",
      source: "builder",
      context: "Pick the region before rollout.",
      answerBehavior: "workflow-resume",
      origin: {
        kind: "workflow",
        workflowName: "builder",
        runId: "run-telegram",
        stepId: "ask-owner",
        taskId: "task-region",
      },
      proposedAnswers: ["us-east-1", "us-west-2", "eu-central-1"],
      timeoutMs: 600_000,
      defaultResolution: "dismiss",
      defaultAnswer: null,
    });
    await flushAsyncNotifications();
    const body = mockedCallTelegramApi.mock.calls[0][2] as {
      reply_markup?: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> };
    };
    expect(ownerQuestionsList).toHaveBeenCalledOnce();
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
      projectId: TEST_PROJECT.projectId,
      id: "abc123",
      tool: "bash",
      risk: "high",
      reason: "Runs shell commands",
      source: "builder",
      sessionId: "",
    });
    await flushAsyncNotifications();
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

  it("does not start a competing callback poll on load when credentials are present", async () => {
    const { startCallbackPoll } = await import("./callback-poll.js");
    const mockStart = vi.mocked(startCallbackPoll);
    mockStart.mockClear();

    const bus = new EventBus();
    telegramModule.onLoad!(makeStubCtx(bus));

    expect(mockStart).not.toHaveBeenCalled();
  });

  it("loads notification subscriptions without a CLI-resolved KotaClient", async () => {
    const { startCallbackPoll } = await import("./callback-poll.js");
    const mockStart = vi.mocked(startCallbackPoll);
    mockStart.mockClear();

    const bus = new EventBus();
    const ctx = makeStubCtx(bus);
    Object.defineProperty(ctx, "client", {
      get() {
        throw new Error("No active KotaClient resolved.");
      },
    });

    expect(() => telegramModule.onLoad!(ctx)).not.toThrow();
    expect(mockStart).not.toHaveBeenCalled();
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
