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
    getDefaultProjectRuntime: () => runtime,
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
  });});
