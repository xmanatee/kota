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
import { buildApprovalCallbackData } from "./approval-callback.js";
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

  it("sends Telegram message with inline keyboard on approval.requested", async () => {
    const bus = new EventBus();
    const approvalsList = vi.fn(async () => ({
      approvals: [{
        id: "abc123",
        scopeId: TEST_PROJECT.projectId,
        kind: "tool_call" as const,
        tool: "bash",
        input: { redacted: true, reason: "tool-io" as const },
        review: {
          status: "available" as const,
          input: { command: "deploy --target /srv/app" },
          context: "user: deploy the client release",
          digest: "a".repeat(64),
        },
        risk: "dangerous" as const,
        reason: "Runs shell commands",
        createdAt: "2026-07-28T22:00:00.000Z",
        status: "pending" as const,
      }],
    }));
    telegramModule.onLoad!(makeStubCtx(bus, makeStubClient({
      approvals: {
        list: approvalsList,
        approve: vi.fn(),
        reject: vi.fn(),
      },
    })));
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
    expect(body.text).toContain("deploy --target /srv/app");
    expect(body.text).toContain("user: deploy the client release");
    expect(body.text).toContain("a".repeat(64));
    expect(body.text).toContain("kota approval approve abc123");
    expect(body.text).toContain("kota approval reject abc123");
    expect(body.reply_markup?.inline_keyboard[0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          callback_data: buildApprovalCallbackData("approve", "a".repeat(64)),
        }),
        expect.objectContaining({
          callback_data: buildApprovalCallbackData("reject", "a".repeat(64)),
        }),
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
  });});
