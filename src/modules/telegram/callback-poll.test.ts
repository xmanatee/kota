import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildApprovalCallbackData,
  pendingApprovalMessageKey,
} from "./approval-callback.js";
import {
  type PendingApprovalMessage,
  startCallbackPoll,
} from "./callback-poll.js";
import { callTelegramApi } from "./client.js";
import {
  acquireTelegramPollingOwner,
  resetTelegramPollingOwnersForTests,
} from "./polling-ownership.js";

vi.mock("./client.js", () => ({
  callTelegramApi: vi.fn(),
}));

const mockedCallTelegramApi = vi.mocked(callTelegramApi);

// Never resolves — used for subsequent getUpdates calls so the poll loop stops.
const hang = (): Promise<never> => new Promise(() => {});

const stubLog = { info: () => {}, warn: vi.fn(), error: () => {}, debug: () => {} };
const TOKEN = "test-token";

const mockGetExecutionSnapshot = vi.fn();
const mockApproveForExecution = vi.fn();
const mockReject = vi.fn();

vi.mock("#modules/approval-queue/index.js", () => ({
  getApprovalQueue: () => ({
    getExecutionSnapshot: mockGetExecutionSnapshot,
    approveForExecution: mockApproveForExecution,
    reject: mockReject,
  }),
}));

const mockOwnerGet = vi.fn();
const mockOwnerAnswer = vi.fn();
const mockOwnerDismiss = vi.fn();

vi.mock("#core/daemon/owner-question-queue.js", () => ({
  getOwnerQuestionQueue: () => ({
    get: mockOwnerGet,
    answer: mockOwnerAnswer,
    dismiss: mockOwnerDismiss,
  }),
}));

function makeCallbackUpdate(
  updateId: number,
  callbackQueryId: string,
  data: string,
  messageId = 42,
  chatId = 99,
) {
  return {
    update_id: updateId,
    callback_query: {
      id: callbackQueryId,
      from: { id: 1, first_name: "Test" },
      message: { message_id: messageId, chat: { id: chatId, type: "private" }, date: 0 },
      data,
    },
  };
}

describe("startCallbackPoll", () => {
  beforeEach(() => {
    resetTelegramPollingOwnersForTests();
    mockedCallTelegramApi.mockReset();
    mockGetExecutionSnapshot.mockReset();
    mockApproveForExecution.mockReset();
    mockReject.mockReset();
    mockOwnerGet.mockReset();
    mockOwnerAnswer.mockReset();
    mockOwnerDismiss.mockReset();
    stubLog.warn.mockReset();
  });

  afterEach(() => {
    resetTelegramPollingOwnersForTests();
  });

  it("refuses to compete with the interactive Telegram poll owner", () => {
    const release = acquireTelegramPollingOwner(TOKEN, {
      owner: "telegram-interactive",
      source: "daemon channel",
    });
    try {
      expect(() =>
        startCallbackPoll(TOKEN, new Map(), new Map(), stubLog),
      ).toThrow(
        'cannot start because "telegram-interactive" (daemon channel) already owns this bot token',
      );
    } finally {
      release();
    }
  });

  it("polls getUpdates with callback_query allowed_updates", async () => {
    mockedCallTelegramApi.mockReturnValueOnce(Promise.resolve([])).mockReturnValue(hang());

    const stop = startCallbackPoll(TOKEN, new Map(), new Map(), stubLog);
    await Promise.resolve();
    await Promise.resolve();
    stop();

    expect(mockedCallTelegramApi).toHaveBeenCalledWith(
      TOKEN,
      "getUpdates",
      expect.objectContaining({ allowed_updates: ["callback_query"] }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  describe("approval callbacks", () => {
    it("approves via queue and edits message on approve callback", async () => {
      const resolvedItem = {
        id: "id1",
        tool: "bash",
        risk: "dangerous",
        reason: "shells",
        input: {},
        createdAt: new Date().toISOString(),
        status: "approved" as const,
      };
      const descriptor = { approvalId: "id1", reviewDigest: "a".repeat(64) };
      mockGetExecutionSnapshot.mockReturnValue({
        ok: true,
        snapshot: { descriptor },
      });
      mockApproveForExecution.mockReturnValue({ ok: true, approval: resolvedItem });

      mockedCallTelegramApi
        .mockReturnValueOnce(
          Promise.resolve([
            makeCallbackUpdate(
              1,
              "cq1",
              buildApprovalCallbackData("approve", "a".repeat(64)),
              10,
              99,
            ),
          ]),
        )
        .mockReturnValueOnce(Promise.resolve(undefined))
        .mockReturnValueOnce(Promise.resolve(undefined))
        .mockReturnValue(hang());

      const pending: Map<string, PendingApprovalMessage> = new Map([
        [pendingApprovalMessageKey("99", 10), {
          approvalId: "id1",
          chatId: "99",
          messageId: 10,
          projectId: "test-project",
          reviewDigest: "a".repeat(64),
        }],
      ]);

      const stop = startCallbackPoll(TOKEN, pending, new Map(), stubLog);
      await new Promise((r) => setTimeout(r, 20));
      stop();

      expect(mockApproveForExecution).toHaveBeenCalledWith(
        descriptor,
        undefined,
        "telegram-inline",
      );
      expect(mockedCallTelegramApi).toHaveBeenCalledWith(TOKEN, "answerCallbackQuery", {
        callback_query_id: "cq1",
        text: "Approved!",
      });
      expect(mockedCallTelegramApi).toHaveBeenCalledWith(
        TOKEN,
        "editMessageText",
        expect.objectContaining({ chat_id: "99", message_id: 10 }),
      );
      expect(pending.has(pendingApprovalMessageKey("99", 10))).toBe(false);
    });

    it("rejects via queue and edits message on reject callback", async () => {
      const resolvedItem = {
        id: "id2",
        tool: "git",
        risk: "moderate",
        reason: "force push",
        input: {},
        createdAt: new Date().toISOString(),
        status: "rejected" as const,
      };
      mockReject.mockReturnValue(resolvedItem);

      mockedCallTelegramApi
        .mockReturnValueOnce(
          Promise.resolve([
            makeCallbackUpdate(
              2,
              "cq2",
              buildApprovalCallbackData("reject", "b".repeat(64)),
              20,
              99,
            ),
          ]),
        )
        .mockReturnValueOnce(Promise.resolve(undefined))
        .mockReturnValueOnce(Promise.resolve(undefined))
        .mockReturnValue(hang());

      const pending: Map<string, PendingApprovalMessage> = new Map([
        [pendingApprovalMessageKey("99", 20), {
          approvalId: "id2",
          chatId: "99",
          messageId: 20,
          projectId: "test-project",
          reviewDigest: "b".repeat(64),
        }],
      ]);

      const stop = startCallbackPoll(TOKEN, pending, new Map(), stubLog);
      await new Promise((r) => setTimeout(r, 20));
      stop();

      expect(mockReject).toHaveBeenCalledWith("id2", undefined, "telegram-inline");
      expect(mockedCallTelegramApi).toHaveBeenCalledWith(TOKEN, "answerCallbackQuery", {
        callback_query_id: "cq2",
        text: "Rejected!",
      });
      expect(mockedCallTelegramApi).toHaveBeenCalledWith(
        TOKEN,
        "editMessageText",
        expect.objectContaining({
          chat_id: "99",
          message_id: 20,
          text: expect.stringContaining("❌ Rejected"),
        }),
      );
      expect(pending.has(pendingApprovalMessageKey("99", 20))).toBe(false);
    });

    it("answers with alert when approval is already resolved", async () => {
      mockGetExecutionSnapshot.mockReturnValue({ ok: false, reason: "not_found" });

      mockedCallTelegramApi
        .mockReturnValueOnce(
          Promise.resolve([
            makeCallbackUpdate(
              3,
              "cq3",
              buildApprovalCallbackData("approve", "c".repeat(64)),
            ),
          ]),
        )
        .mockReturnValueOnce(Promise.resolve(undefined))
        .mockReturnValue(hang());

      const stop = startCallbackPoll(TOKEN, new Map(), new Map(), stubLog);
      await new Promise((r) => setTimeout(r, 20));
      stop();

      expect(mockedCallTelegramApi).toHaveBeenCalledWith(TOKEN, "answerCallbackQuery", {
        callback_query_id: "cq3",
        text: "Approval already resolved or not found.",
        show_alert: true,
      });
    });});});
