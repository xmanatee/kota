import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type AgentHarness,
  UNKNOWN_AGENT_USAGE,
} from "#core/agent-harness/index.js";
import type { PendingOwnerQuestion } from "#core/daemon/owner-question-queue.js";
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
import { callTelegramApi, } from "./client.js";
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
async function flushAsyncNotifications(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

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
    unloadTelegramModule();
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
        }),
      ),
    );
    bus.emit("owner.question.asked", {
      scopeId: TEST_SCOPE.scopeId,
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
  });});
