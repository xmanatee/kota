import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  type AgentHarness,
  resolveAgentHarness,
  UNKNOWN_AGENT_USAGE,
} from "#core/agent-harness/index.js";
import type { CapabilityReadinessSource } from "#core/daemon/capability-readiness.js";
import type { DirectoryScope } from "#core/daemon/scope-registry.js";
import { EventBus } from "#core/events/event-bus.js";
import { ModuleStorage } from "#core/modules/module-storage.js";
import type { ModuleRuntimeContext } from "#core/modules/module-types.js";
import { makeStubEventProxy } from "#core/modules/testing/index.js";
import {
  createKotaClientTestDouble,
  type DeclaredKotaClientHandlers,
} from "#core/server/daemon-client-test-support.js";
import type { KotaClient } from "#root/client/kota-client.generated.js";
import { makeTelegramInteractiveChannel, makeTelegramStatusChannel } from "./channels.js";
import { callTelegramApi, TelegramApiError } from "./client.js";
import {
  TELEGRAM_INTERACTIVE_BACKEND_CAPABILITY_ID,
} from "./index.js";
import { loadTelegramModule, unloadTelegramModule } from "./notification-subscriptions.js";

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

function makeTestHarness(
  name: string,
  unsupportedRunOptions: AgentHarness["unsupportedRunOptions"] = [],
): AgentHarness {
  return {
    name,
    description: `${name} test harness`,
    supportsMultiTurn: true,
    supportedHookKinds: ["preRun", "postRun"],
    askOwnerToolName: null,
    emitsAgentMessageStream: false,
    toolControl: name === "codex" ? "native" : "kota",
    unsupportedRunOptions,
    async run() {
      return {
        text: "ok",
        streamedText: "ok",
        turns: 1,
        usage: UNKNOWN_AGENT_USAGE,
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

const mockedResolveAgentHarness = vi.mocked(resolveAgentHarness);

const TEST_SCOPE: DirectoryScope = {
  scopeId: "test-scope",
  scopeRoot: "/tmp/test",
  displayName: "KOTA",
};

function makeStubClient(
  overrides: DeclaredKotaClientHandlers = {},
): KotaClient {
  return createKotaClientTestDouble({
    scopes: {
      list: vi.fn(async () => ({
        ok: true as const,
        defaultScopeId: TEST_SCOPE.scopeId,
        activeScopeId: null,
        scopes: [TEST_SCOPE],
      })),
      use: vi.fn(),
    },
    ownerQuestions: {
      list: vi.fn(async () => ({ questions: [] })),
      answer: vi.fn(),
      dismiss: vi.fn(),
    },
    ...overrides,
  });
}

function makeStubCtx(
  bus?: EventBus,
  client: KotaClient = makeStubClient(),
  config: ModuleRuntimeContext["config"] = {} as ModuleRuntimeContext["config"],
): Parameters<typeof loadTelegramModule>[0] & { verbose: boolean } {
  const b = bus ?? new EventBus();
  return {
    cwd: "/tmp",
    verbose: false,
    config,
    storage: new ModuleStorage("/tmp/test", "telegram"),
    getModuleConfig: () => undefined,
    log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    getSecret: (key) => process.env[key] ?? null,
    events: makeStubEventProxy(b),
    registerProvider: () => {},
    getProvider: () => null,
    client,
  };
}

function makeChannelStartContext(
  overrides: { reportFailure?: (message: string) => void } = {},
) {
  const runtime = {
    scope: TEST_SCOPE,
    scheduler: { count: () => 0 },
  } as never;
  return {
    getDefaultScopeRuntime: () => runtime,
    getScopeRuntime: () => runtime,
    log: () => {},
    reportFailure: overrides.reportFailure ?? (() => {}),
    getWorkflowStatus: () => ({
      runtimeState: { activeRuns: [], completedRuns: 0, pendingRuns: [], workflows: {} },
      dispatchPaused: false,
      runsDir: "/tmp/.kota/runs",
      runAuthority: {
        authorityCriticalRunIds: new Set<string>(),
        operationallyActiveRunIds: new Set<string>(),
        terminalRunIds: new Set<string>(),
      },
    }),
  };
}


const mockedCallTelegramApi = vi.mocked(callTelegramApi);
describe("Telegram channel startup and readiness", () => {
 beforeEach(() => { mockedResolveAgentHarness.mockReset().mockImplementation(name => makeTestHarness(name)); });
it("reports the default Codex backend as ready through setup capability readiness", async () => {
    const savedPreset = process.env.KOTA_PRESET;
    delete process.env.KOTA_PRESET;
    const readiness = { source: null as CapabilityReadinessSource | null };
    const ctx = makeStubCtx(
      undefined,
      makeStubClient(),
      {
        model: "gpt-5.6-sol",
        serve: { defaultAutonomyMode: "autonomous" },
      } as ModuleRuntimeContext["config"],
    );
    ctx.registerProvider = <T,>(_token: unknown, provider: T): void => {
      readiness.source = provider as unknown as CapabilityReadinessSource;
    };

    loadTelegramModule(ctx);
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
      if (savedPreset !== undefined) process.env.KOTA_PRESET = savedPreset;
      else delete process.env.KOTA_PRESET;
      unloadTelegramModule();
    }
  });

it("rejects a passive Telegram session when the selected harness cannot enforce it", () => {
    mockedResolveAgentHarness.mockImplementation((name: string) =>
      makeTestHarness(name, [{
        runOption: "autonomyMode.passive",
        option: 'autonomyMode="passive"',
        reason: "native tools cannot enforce passive mode",
      }]),
    );
    const readiness = { source: null as CapabilityReadinessSource | null };
    const ctx = makeStubCtx(
      undefined,
      makeStubClient(),
      {
        model: "gpt-5.6-sol",
        serve: { defaultAutonomyMode: "passive" },
      } as ModuleRuntimeContext["config"],
    );
    ctx.registerProvider = <T,>(_token: unknown, provider: T): void => {
      readiness.source = provider as unknown as CapabilityReadinessSource;
    };

    loadTelegramModule(ctx);
    try {
      const source = readiness.source;
      if (!source) throw new Error("readiness source not registered");
      expect(source.probe()).toEqual([
        expect.objectContaining({
          id: TELEGRAM_INTERACTIVE_BACKEND_CAPABILITY_ID,
          status: "unavailable",
          reason: "interactive_backend_unavailable",
          message: expect.stringContaining('cannot use autonomyMode "passive"'),
        }),
      ]);
    } finally {
      unloadTelegramModule();
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
        model: "openai/gpt-5.6-sol",
        serve: { defaultAutonomyMode: "supervised" },
      } as ModuleRuntimeContext["config"],
    );
    ctx.registerProvider = <T,>(_token: unknown, provider: T): void => {
      readiness.source = provider as unknown as CapabilityReadinessSource;
    };

    try {
      loadTelegramModule(ctx);
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
      unloadTelegramModule();
      if (savedOpenAiKey !== undefined) process.env.OPENAI_API_KEY = savedOpenAiKey;
      else delete process.env.OPENAI_API_KEY;
    }
  });

it("telegram-status channel reports unavailable when env vars are missing", async () => {
    const savedToken = process.env.TELEGRAM_BOT_TOKEN;
    const savedChatId = process.env.TELEGRAM_ALERT_CHAT_ID;
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_ALERT_CHAT_ID;
    try {
      const channel = makeTelegramStatusChannel(makeStubCtx());
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
      const channel = makeTelegramInteractiveChannel(makeStubCtx(), []);
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
    const savedPreset = process.env.KOTA_PRESET;
    process.env.TELEGRAM_BOT_TOKEN = "bot-token-test";
    process.env.TELEGRAM_ALERT_CHAT_ID = "123456789";
    delete process.env.KOTA_PRESET;
    try {
      const channel = makeTelegramInteractiveChannel(makeStubCtx(
          undefined,
          makeStubClient(),
          {
            model: "gpt-5.6-sol",
            serve: { defaultAutonomyMode: "passive" },
          } as ModuleRuntimeContext["config"],
        ), []);
      if (!channel) throw new Error("telegram-interactive channel missing");
      const result = channel.create(makeChannelStartContext());
      expect(result.status).toBe("started");
      expect(mockedResolveAgentHarness).toHaveBeenCalledWith("codex");
    } finally {
      if (savedPreset !== undefined) process.env.KOTA_PRESET = savedPreset;
      else delete process.env.KOTA_PRESET;
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
      const channel = makeTelegramInteractiveChannel(makeStubCtx(
          undefined,
          makeStubClient(),
          {
            model: "gpt-5.6-sol",
            modelProvider: { type: "openai" },
            serve: { defaultAutonomyMode: "passive" },
          } as ModuleRuntimeContext["config"],
        ), []);
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
      const channel = makeTelegramInteractiveChannel(makeStubCtx(
          undefined,
          makeStubClient(),
          {
            defaultAgentHarness: "openai-tools",
            model: "openrouter/openrouter/auto",
            serve: { defaultAutonomyMode: "supervised" },
          } as ModuleRuntimeContext["config"],
        ), []);
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
      const channel = makeTelegramInteractiveChannel(makeStubCtx(
          undefined,
          makeStubClient(),
          {
            model: "openai/gpt-5.6-sol",
            serve: { defaultAutonomyMode: "supervised" },
          } as ModuleRuntimeContext["config"],
        ), []);
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
      const channel = makeTelegramStatusChannel(ctx);
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
      const channel = makeTelegramStatusChannel(makeStubCtx());
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
      const channel = makeTelegramInteractiveChannel(makeStubCtx(
          bus,
          makeStubClient(),
          {
            serve: { defaultAutonomyMode: "passive" },
          } as ModuleRuntimeContext["config"],
        ), []);
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
        scopeId: TEST_SCOPE.scopeId,
        severity: "error",
        actionability: "owner-action",
        dedupeKey: "module:telegram:getupdates-conflict",
      });
    } finally {
      if (savedToken !== undefined) process.env.TELEGRAM_BOT_TOKEN = savedToken;
      else delete process.env.TELEGRAM_BOT_TOKEN;
      if (savedChatId !== undefined) process.env.TELEGRAM_ALERT_CHAT_ID = savedChatId;
      else delete process.env.TELEGRAM_ALERT_CHAT_ID;
      unloadTelegramModule();
    }
  });

it("reports poll-loop recovery after a healthy getUpdates request", async () => {
    const savedToken = process.env.TELEGRAM_BOT_TOKEN;
    const savedChatId = process.env.TELEGRAM_ALERT_CHAT_ID;
    process.env.TELEGRAM_BOT_TOKEN = "bot-token-test";
    process.env.TELEGRAM_ALERT_CHAT_ID = "123456789";
    mockedCallTelegramApi.mockReset();
    let pollCount = 0;
    mockedCallTelegramApi.mockImplementation(
      async (_token, method, _params, options) => {
        if (method === "getMe") {
          return { id: 1, first_name: "TestBot", username: "test_bot" } as never;
        }
        if (method === "getUpdates") {
          pollCount++;
          if (pollCount === 1) return [] as never;
          return await new Promise((_, reject) => {
            const signal = options?.signal;
            const abort = () => reject(new Error("poll stopped"));
            if (signal?.aborted) abort();
            else signal?.addEventListener("abort", abort, { once: true });
          });
        }
        return {} as never;
      },
    );
    const ctx = makeStubCtx(
      undefined,
      makeStubClient(),
      { serve: { defaultAutonomyMode: "passive" } } as ModuleRuntimeContext["config"],
    );
    const operationRecovered = vi.fn();
    ctx.log.operationRecovered = operationRecovered;

    try {
      const channel = makeTelegramInteractiveChannel(ctx, []);
      if (!channel) throw new Error("telegram-interactive channel missing");
      const result = channel.create(makeChannelStartContext());
      if (result.status !== "started") {
        throw new Error(`telegram-interactive did not start: ${result.status}`);
      }

      await result.adapter.start();
      await flushAsyncNotifications();
      expect(operationRecovered).toHaveBeenCalledWith(
        TEST_SCOPE.scopeId,
        "poll-loop",
        "telegram-interactive poll loop completed a healthy getUpdates request",
      );
      await result.adapter.stop();
    } finally {
      if (savedToken !== undefined) process.env.TELEGRAM_BOT_TOKEN = savedToken;
      else delete process.env.TELEGRAM_BOT_TOKEN;
      if (savedChatId !== undefined) process.env.TELEGRAM_ALERT_CHAT_ID = savedChatId;
      else delete process.env.TELEGRAM_ALERT_CHAT_ID;
      unloadTelegramModule();
    }
  });
});

async function flushAsyncNotifications(): Promise<void> { await new Promise(resolve => setImmediate(resolve)); }
