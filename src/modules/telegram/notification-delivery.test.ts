import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import type { PendingOwnerQuestion } from "#core/daemon/owner-question-queue.js";
import type { DirectoryScope } from "#core/daemon/scope-registry.js";
import { EventBus } from "#core/events/event-bus.js";
import { ModuleStorage } from "#core/modules/module-storage.js";
import { makeStubEventProxy } from "#core/modules/testing/index.js";
import { createKotaClientTestDouble, type DeclaredKotaClientHandlers } from "#core/server/daemon-client-test-support.js";
import { buildApprovalCallbackData } from "./approval-callback.js";
import { callTelegramApi } from "./client.js";
import { loadTelegramModule } from "./notification-subscriptions.js";
import { createTelegramRuntimeState } from "./runtime-state.js";

vi.mock("./client.js", async (original) => ({ ...await original<typeof import("./client.js")>(), callTelegramApi: vi.fn() }));
const mockedCallTelegramApi = vi.mocked(callTelegramApi);
const FAKE_TOKEN = "bot-token-test";
const FAKE_CHAT_ID = "123456789";
const TEST_SCOPE: DirectoryScope = { scopeId: "test-scope", scopeRoot: "/tmp/test", displayName: "KOTA" };
function makeStubClient(overrides: DeclaredKotaClientHandlers = {}) {
  return createKotaClientTestDouble({
    scopes: { list: vi.fn(async () => ({ ok: true as const, defaultScopeId: TEST_SCOPE.scopeId, activeScopeId: null, scopes: [TEST_SCOPE] })) },
    ownerQuestions: { list: vi.fn(async () => ({ questions: [] })) },
    ...overrides,
  });
}
function makeStubCtx(bus: EventBus, client = makeStubClient()): Parameters<typeof loadTelegramModule>[0] {
  return {
    cwd: "/tmp/test", config: {}, storage: new ModuleStorage("/tmp/test", "telegram"),
    getModuleConfig: () => undefined,
    getSecret: key => process.env[key] ?? null,
    events: makeStubEventProxy(bus),
    getProvider: () => null, registerProvider: () => {},
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    client,
  };
}
async function flushAsyncNotifications() { await new Promise(resolve => setImmediate(resolve)); }

// Notification adapter ports only: typed events, scope/client projection, credentials and Bot API.
// Queue transitions and module lifecycle are exercised by their production owners.
describe("Telegram notification delivery", () => {
  beforeEach(() => {
    mockedCallTelegramApi.mockReset().mockResolvedValue({ message_id: 42 } as never);
    vi.stubEnv("TELEGRAM_BOT_TOKEN", FAKE_TOKEN);
    vi.stubEnv("TELEGRAM_ALERT_CHAT_ID", FAKE_CHAT_ID);
  });
  afterEach(() => { vi.unstubAllEnvs(); });
it("sends Telegram message on workflow.failure.alert", async () => {
    const bus = new EventBus();
    onTestFinished(loadTelegramModule(makeStubCtx(bus), createTelegramRuntimeState()));
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
    onTestFinished(loadTelegramModule(makeStubCtx(bus), createTelegramRuntimeState()));
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
    onTestFinished(loadTelegramModule(makeStubCtx(bus), createTelegramRuntimeState()));
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
    onTestFinished(loadTelegramModule(makeStubCtx(bus), createTelegramRuntimeState()));
    bus.emit("owner.question.asked", {
      scopeId: TEST_SCOPE.scopeId,
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
    onTestFinished(loadTelegramModule(
      makeStubCtx(
        bus,
        makeStubClient({
          ownerQuestions: {
            list: ownerQuestionsList,
            answer: vi.fn(),
            dismiss: vi.fn(),
          },
        }),
      ), createTelegramRuntimeState(),
    ));
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
  });

it("sends Telegram message with inline keyboard on approval.requested", async () => {
    const bus = new EventBus();
    const approvalsList = vi.fn(async () => ({
      approvals: [{
        id: "abc123",
        scopeId: TEST_SCOPE.scopeId,
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
    onTestFinished(loadTelegramModule(makeStubCtx(bus, makeStubClient({
      approvals: {
        list: approvalsList,
        approve: vi.fn(),
        reject: vi.fn(),
      },
    })), createTelegramRuntimeState()));
    bus.emit("approval.requested", {
      scopeId: TEST_SCOPE.scopeId,
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

it("does not send Telegram message when credentials are missing", async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    const bus = new EventBus();
    onTestFinished(loadTelegramModule(makeStubCtx(bus), createTelegramRuntimeState()));
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
    const dispose = loadTelegramModule(makeStubCtx(bus), createTelegramRuntimeState());
    onTestFinished(dispose);
    dispose();
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

it("loads notification subscriptions without a CLI-resolved KotaClient", async () => {

    const bus = new EventBus();
    const ctx = makeStubCtx(bus);
    Object.defineProperty(ctx, "client", {
      get() {
        throw new Error("No active KotaClient resolved.");
      },
    });

    expect(() => onTestFinished(loadTelegramModule(ctx, createTelegramRuntimeState()))).not.toThrow();
    expect(mockedCallTelegramApi).not.toHaveBeenCalled();
  });
});
