import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentHarness } from "#core/agent-harness/index.js";
import type { DirectoryScope } from "#core/daemon/scope-registry.js";
import { EventBus } from "#core/events/event-bus.js";
import { ModuleStorage } from "#core/modules/module-storage.js";
import type { ModuleRuntimeContext } from "#core/modules/module-types.js";
import { makeStubEventProxy } from "#core/modules/testing/index.js";
import type { KotaClient } from "#core/server/kota-client.js";
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
async function flushAsyncNotifications(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

const TEST_SCOPE: DirectoryScope = {
  scopeId: "test-scope",
  scopeRoot: "/tmp/test",
  displayName: "KOTA",
};

function makeStubClient(
  overrides: Partial<KotaClient> = {},
): KotaClient {
  const client = {
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
  } as Partial<KotaClient>;
  client.forScope = vi.fn(() => client as KotaClient);
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
  });});
