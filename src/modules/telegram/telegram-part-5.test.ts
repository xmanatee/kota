import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  type AgentHarness,
  resolveAgentHarness,
  UNKNOWN_AGENT_USAGE,
} from "#core/agent-harness/index.js";
import type { DirectoryScope } from "#core/daemon/scope-registry.js";
import { EventBus } from "#core/events/event-bus.js";
import { ModuleStorage } from "#core/modules/module-storage.js";
import type { ModuleRuntimeContext } from "#core/modules/module-types.js";
import { resolveModuleChannels } from "#core/modules/module-types.js";
import { makeStubEventProxy } from "#core/modules/testing/index.js";
import {
  createKotaClientTestDouble,
  type DeclaredKotaClientHandlers,
} from "#core/server/daemon-client-test-support.js";
import type { KotaClient } from "#root/client/kota-client.generated.js";
import { callTelegramApi, TelegramApiError } from "./client.js";
import telegramModule from "./index.js";
import { unloadTelegramModule } from "./notification-subscriptions.js";

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

const mockedCallTelegramApi = vi.mocked(callTelegramApi);
const mockedResolveAgentHarness = vi.mocked(resolveAgentHarness);

async function flushAsyncNotifications(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

const TEST_SCOPE: DirectoryScope = {
  scopeId: "test-scope",
  scopeRoot: "/tmp/test",
  displayName: "KOTA",
};

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
    }),
  };
}

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
): ModuleRuntimeContext {
  const b = bus ?? new EventBus();
  return {
    cwd: "/tmp",
    verbose: false,
    config,
    storage: new ModuleStorage("/tmp/test", "telegram"),
    registerGroup: () => {},
    getRoutes: () => [],
    getContributedWorkflows: () => [],
    getContributedChannels: () => [],
      getContributedUiSurfaces: () => [],
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
        scopeId: TEST_SCOPE.scopeId,
        severity: "warning",
        actionability: "external-service",
        dedupeKey: "module:telegram:getupdates-conflict",
      });
    } finally {
      if (savedToken !== undefined) process.env.TELEGRAM_BOT_TOKEN = savedToken;
      else delete process.env.TELEGRAM_BOT_TOKEN;
      if (savedChatId !== undefined) process.env.TELEGRAM_ALERT_CHAT_ID = savedChatId;
      else delete process.env.TELEGRAM_ALERT_CHAT_ID;
      unloadTelegramModule();
    }
  });});
