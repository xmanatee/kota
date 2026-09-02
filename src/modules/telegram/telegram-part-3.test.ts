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
      runAuthority: {
        authorityCriticalRunIds: new Set<string>(),
        operationallyActiveRunIds: new Set<string>(),
        terminalRunIds: new Set<string>(),
      },
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

  it("telegram-interactive channel starts with the default Codex preset without a model provider", async () => {
    const savedToken = process.env.TELEGRAM_BOT_TOKEN;
    const savedChatId = process.env.TELEGRAM_ALERT_CHAT_ID;
    const savedPreset = process.env.KOTA_PRESET;
    process.env.TELEGRAM_BOT_TOKEN = "bot-token-test";
    process.env.TELEGRAM_ALERT_CHAT_ID = "123456789";
    delete process.env.KOTA_PRESET;
    try {
      const channels = await resolveModuleChannels(
        telegramModule,
        makeStubCtx(
          undefined,
          makeStubClient(),
          {
            model: "gpt-5.6-sol",
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
      const channels = await resolveModuleChannels(
        telegramModule,
        makeStubCtx(
          undefined,
          makeStubClient(),
          {
            model: "gpt-5.6-sol",
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
  });});
