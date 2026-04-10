import { beforeEach, describe, expect, it, vi } from "vitest";
import { type PendingApprovalMessage, startApprovalCallbackPoll } from "./approval-callback-poll.js";
import { callTelegramApi } from "./client.js";

vi.mock("./client.js", () => ({
  callTelegramApi: vi.fn(),
}));

const mockedCallTelegramApi = vi.mocked(callTelegramApi);

// Never resolves — used for subsequent getUpdates calls so the poll loop stops.
const hang = (): Promise<never> => new Promise(() => {});

const stubLog = { info: () => {}, warn: vi.fn(), error: () => {}, debug: () => {} };
const TOKEN = "test-token";

// Shared queue mock accessible across tests
const mockApprove = vi.fn();
const mockReject = vi.fn();

vi.mock("#modules/approval-queue/index.js", () => ({
  getApprovalQueue: () => ({ approve: mockApprove, reject: mockReject }),
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

describe("startApprovalCallbackPoll", () => {
  beforeEach(() => {
    mockedCallTelegramApi.mockReset();
    mockApprove.mockReset();
    mockReject.mockReset();
    stubLog.warn.mockReset();
  });

  it("polls getUpdates with callback_query allowed_updates", async () => {
    mockedCallTelegramApi.mockReturnValueOnce(Promise.resolve([])).mockReturnValue(hang());

    const stop = startApprovalCallbackPoll(TOKEN, new Map(), stubLog);
    await Promise.resolve();
    await Promise.resolve();
    stop();

    expect(mockedCallTelegramApi).toHaveBeenCalledWith(
      TOKEN,
      "getUpdates",
      expect.objectContaining({ allowed_updates: ["callback_query"] }),
    );
  });

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
    mockApprove.mockReturnValue(resolvedItem);

    mockedCallTelegramApi
      .mockReturnValueOnce(
        Promise.resolve([makeCallbackUpdate(1, "cq1", "approve:id1", 10, 99)]),
      ) // getUpdates
      .mockReturnValueOnce(Promise.resolve(undefined)) // answerCallbackQuery
      .mockReturnValueOnce(Promise.resolve(undefined)) // editMessageText
      .mockReturnValue(hang()); // subsequent getUpdates

    const pending: Map<string, PendingApprovalMessage> = new Map([
      ["id1", { chatId: "99", messageId: 10 }],
    ]);

    const stop = startApprovalCallbackPoll(TOKEN, pending, stubLog);
    await new Promise((r) => setTimeout(r, 20));
    stop();

    expect(mockApprove).toHaveBeenCalledWith("id1", undefined, "telegram-inline");
    expect(mockedCallTelegramApi).toHaveBeenCalledWith(TOKEN, "answerCallbackQuery", {
      callback_query_id: "cq1",
      text: "Approved!",
    });
    expect(mockedCallTelegramApi).toHaveBeenCalledWith(
      TOKEN,
      "editMessageText",
      expect.objectContaining({ chat_id: "99", message_id: 10 }),
    );
    expect(pending.has("id1")).toBe(false);
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
        Promise.resolve([makeCallbackUpdate(2, "cq2", "reject:id2", 20, 99)]),
      ) // getUpdates
      .mockReturnValueOnce(Promise.resolve(undefined)) // answerCallbackQuery
      .mockReturnValueOnce(Promise.resolve(undefined)) // editMessageText
      .mockReturnValue(hang()); // subsequent getUpdates

    const pending: Map<string, PendingApprovalMessage> = new Map([
      ["id2", { chatId: "99", messageId: 20 }],
    ]);

    const stop = startApprovalCallbackPoll(TOKEN, pending, stubLog);
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
    expect(pending.has("id2")).toBe(false);
  });

  it("answers with alert when approval is already resolved", async () => {
    mockApprove.mockReturnValue(null);

    mockedCallTelegramApi
      .mockReturnValueOnce(
        Promise.resolve([makeCallbackUpdate(3, "cq3", "approve:id3")]),
      ) // getUpdates
      .mockReturnValueOnce(Promise.resolve(undefined)) // answerCallbackQuery
      .mockReturnValue(hang()); // subsequent getUpdates

    const stop = startApprovalCallbackPoll(TOKEN, new Map(), stubLog);
    await new Promise((r) => setTimeout(r, 20));
    stop();

    expect(mockedCallTelegramApi).toHaveBeenCalledWith(TOKEN, "answerCallbackQuery", {
      callback_query_id: "cq3",
      text: "Approval already resolved or not found.",
      show_alert: true,
    });
  });

  it("logs warning on API error and does not crash", async () => {
    mockedCallTelegramApi
      .mockReturnValueOnce(Promise.reject(new Error("network down")))
      .mockReturnValue(hang());

    const stop = startApprovalCallbackPoll(TOKEN, new Map(), stubLog);
    await new Promise((r) => setTimeout(r, 20));
    stop();

    expect(stubLog.warn).toHaveBeenCalledWith(
      expect.stringContaining("network down"),
    );
  });
});
