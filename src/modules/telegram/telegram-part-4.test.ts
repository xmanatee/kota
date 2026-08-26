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
import { callTelegramApi, } from "./client.js";
import telegramModule from "./index.js";

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
            model: "openai/gpt-5.6-sol",
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
  });});
