import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type PendingMessage,
  startCallbackPoll,
} from "./callback-poll.js";
import { callTelegramApi } from "./client.js";
import {
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

  describe("owner-question callbacks", () => {
    it("answers question via queue and edits message on answer callback", async () => {
      const pendingQuestion = {
        id: "oq1",
        seq: 0,
        context: "ctx",
        question: "Split migration?",
        reason: "risky",
        source: "builder",
        createdAt: new Date().toISOString(),
        status: "pending" as const,
        proposedAnswers: ["Yes", "No", "Defer"],
      };
      mockOwnerGet.mockReturnValue(pendingQuestion);
      mockOwnerAnswer.mockReturnValue({
        ...pendingQuestion,
        status: "answered" as const,
        answer: "No",
      });

      mockedCallTelegramApi
        .mockReturnValueOnce(
          Promise.resolve([makeCallbackUpdate(4, "cq4", "answer:oq1:1", 30, 99)]),
        )
        .mockReturnValueOnce(Promise.resolve(undefined))
        .mockReturnValueOnce(Promise.resolve(undefined))
        .mockReturnValue(hang());

      const pending: Map<string, PendingMessage> = new Map([
        ["oq1", { chatId: "99", messageId: 30, scopeId: "test-scope" }],
      ]);

      const stop = startCallbackPoll(TOKEN, new Map(), pending, stubLog);
      await new Promise((r) => setTimeout(r, 20));
      stop();

      expect(mockOwnerAnswer).toHaveBeenCalledWith("oq1", "No", "telegram-inline");
      expect(mockedCallTelegramApi).toHaveBeenCalledWith(TOKEN, "answerCallbackQuery", {
        callback_query_id: "cq4",
        text: "Answered: No",
      });
      expect(mockedCallTelegramApi).toHaveBeenCalledWith(
        TOKEN,
        "editMessageText",
        expect.objectContaining({
          chat_id: "99",
          message_id: 30,
          text: expect.stringContaining("✅ Answered"),
        }),
      );
      const editArgs = mockedCallTelegramApi.mock.calls.find(
        ([, method]) => method === "editMessageText",
      )?.[2] as { text: string };
      expect(editArgs.text).toContain("Answer: No");
      expect(pending.has("oq1")).toBe(false);
    });

    it("dismisses question via queue and edits message on dismiss callback", async () => {
      mockOwnerDismiss.mockReturnValue({
        id: "oq2",
        seq: 0,
        context: "ctx",
        question: "Adopt new CI runner?",
        reason: "unclear",
        source: "explorer",
        createdAt: new Date().toISOString(),
        status: "dismissed" as const,
      });

      mockedCallTelegramApi
        .mockReturnValueOnce(
          Promise.resolve([makeCallbackUpdate(5, "cq5", "dismiss:oq2", 40, 99)]),
        )
        .mockReturnValueOnce(Promise.resolve(undefined))
        .mockReturnValueOnce(Promise.resolve(undefined))
        .mockReturnValue(hang());

      const pending: Map<string, PendingMessage> = new Map([
        ["oq2", { chatId: "99", messageId: 40, scopeId: "test-scope" }],
      ]);

      const stop = startCallbackPoll(TOKEN, new Map(), pending, stubLog);
      await new Promise((r) => setTimeout(r, 20));
      stop();

      expect(mockOwnerDismiss).toHaveBeenCalledWith("oq2", undefined, "telegram-inline");
      expect(mockedCallTelegramApi).toHaveBeenCalledWith(TOKEN, "answerCallbackQuery", {
        callback_query_id: "cq5",
        text: "Dismissed.",
      });
      expect(mockedCallTelegramApi).toHaveBeenCalledWith(
        TOKEN,
        "editMessageText",
        expect.objectContaining({
          chat_id: "99",
          message_id: 40,
          text: expect.stringContaining("❌ Dismissed"),
        }),
      );
      expect(pending.has("oq2")).toBe(false);
    });

    it("alerts when answering an already-resolved question", async () => {
      mockOwnerGet.mockReturnValue({
        id: "oq3",
        status: "answered",
        proposedAnswers: ["Yes", "No"],
      });

      mockedCallTelegramApi
        .mockReturnValueOnce(
          Promise.resolve([makeCallbackUpdate(6, "cq6", "answer:oq3:0")]),
        )
        .mockReturnValueOnce(Promise.resolve(undefined))
        .mockReturnValue(hang());

      const stop = startCallbackPoll(TOKEN, new Map(), new Map(), stubLog);
      await new Promise((r) => setTimeout(r, 20));
      stop();

      expect(mockOwnerAnswer).not.toHaveBeenCalled();
      expect(mockedCallTelegramApi).toHaveBeenCalledWith(TOKEN, "answerCallbackQuery", {
        callback_query_id: "cq6",
        text: "Question already resolved or not found.",
        show_alert: true,
      });
    });

    it("alerts on invalid answer index", async () => {
      mockOwnerGet.mockReturnValue({
        id: "oq4",
        status: "pending",
        proposedAnswers: ["Yes", "No"],
      });

      mockedCallTelegramApi
        .mockReturnValueOnce(
          Promise.resolve([makeCallbackUpdate(7, "cq7", "answer:oq4:9")]),
        )
        .mockReturnValueOnce(Promise.resolve(undefined))
        .mockReturnValue(hang());

      const stop = startCallbackPoll(TOKEN, new Map(), new Map(), stubLog);
      await new Promise((r) => setTimeout(r, 20));
      stop();

      expect(mockOwnerAnswer).not.toHaveBeenCalled();
      expect(mockedCallTelegramApi).toHaveBeenCalledWith(TOKEN, "answerCallbackQuery", {
        callback_query_id: "cq7",
        text: "Invalid answer selection.",
        show_alert: true,
      });
    });

    it("alerts when dismissing an already-resolved question", async () => {
      mockOwnerDismiss.mockReturnValue(null);

      mockedCallTelegramApi
        .mockReturnValueOnce(
          Promise.resolve([makeCallbackUpdate(8, "cq8", "dismiss:oq5")]),
        )
        .mockReturnValueOnce(Promise.resolve(undefined))
        .mockReturnValue(hang());

      const stop = startCallbackPoll(TOKEN, new Map(), new Map(), stubLog);
      await new Promise((r) => setTimeout(r, 20));
      stop();

      expect(mockedCallTelegramApi).toHaveBeenCalledWith(TOKEN, "answerCallbackQuery", {
        callback_query_id: "cq8",
        text: "Question already resolved or not found.",
        show_alert: true,
      });
    });});

  it("logs warning on API error and does not crash", async () => {
    mockedCallTelegramApi
      .mockReturnValueOnce(Promise.reject(new Error("network down")))
      .mockReturnValue(hang());

    const stop = startCallbackPoll(TOKEN, new Map(), new Map(), stubLog);
    await new Promise((r) => setTimeout(r, 20));
    stop();

    expect(stubLog.warn).toHaveBeenCalledWith(
      expect.stringContaining("network down"),
    );
  });});
