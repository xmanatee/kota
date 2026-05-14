import { beforeEach, describe, expect, it, vi } from "vitest";
import { callTelegramApi } from "./client.js";
import {
  type PendingMessage,
  tryHandleOwnerQuestionReply,
} from "./owner-question-reply.js";

vi.mock("./client.js", () => ({
  callTelegramApi: vi.fn(),
}));

const mockedCallTelegramApi = vi.mocked(callTelegramApi);

const mockOwnerAnswer = vi.fn();

vi.mock("#core/daemon/owner-question-queue.js", () => ({
  getOwnerQuestionQueue: () => ({ answer: mockOwnerAnswer }),
}));

const stubLog = {
  info: () => {},
  warn: vi.fn(),
  error: () => {},
  debug: () => {},
};

describe("tryHandleOwnerQuestionReply", () => {
  beforeEach(() => {
    mockedCallTelegramApi.mockReset();
    mockedCallTelegramApi.mockResolvedValue(undefined as never);
    mockOwnerAnswer.mockReset();
    stubLog.warn.mockReset();
  });

  it("records a free-form chat reply against the tracked owner question and edits the original message", async () => {
    mockOwnerAnswer.mockReturnValue({
      id: "oq-free-form",
      source: "builder",
      reason: "risky variant pick",
      question: "Variant a or b?",
      answer: "variant-a, but only land follow-up (a) for now",
    });
    const pending: Map<string, PendingMessage> = new Map([
      ["oq-free-form", { chatId: "99", messageId: 30, projectId: "test-project" }],
    ]);

    const handled = await tryHandleOwnerQuestionReply({
      token: "tok",
      chatId: 99,
      replyToMessageId: 30,
      text: "variant-a, but only land follow-up (a) for now",
      pending,
      allowedChatIds: [99],
      log: stubLog,
    });

    expect(handled).toBe(true);
    expect(mockOwnerAnswer).toHaveBeenCalledWith(
      "oq-free-form",
      "variant-a, but only land follow-up (a) for now",
      "telegram-reply",
    );
    expect(mockedCallTelegramApi).toHaveBeenCalledWith(
      "tok",
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
    expect(editArgs.text).toContain(
      "Answer: variant-a, but only land follow-up (a) for now",
    );
    expect(pending.has("oq-free-form")).toBe(false);
  });

  it("falls through (returns false) when the reply does not match any tracked owner-question message", async () => {
    const pending: Map<string, PendingMessage> = new Map([
      ["oq-free-form", { chatId: "99", messageId: 30, projectId: "test-project" }],
    ]);

    const handled = await tryHandleOwnerQuestionReply({
      token: "tok",
      chatId: 99,
      replyToMessageId: 999,
      text: "what about edge case X?",
      pending,
      allowedChatIds: [99],
      log: stubLog,
    });

    expect(handled).toBe(false);
    expect(mockOwnerAnswer).not.toHaveBeenCalled();
    expect(mockedCallTelegramApi).not.toHaveBeenCalled();
    expect(pending.has("oq-free-form")).toBe(true);
  });

  it("does not resolve owner questions for replies from chats outside the allowlist", async () => {
    const pending: Map<string, PendingMessage> = new Map([
      ["oq-free-form", { chatId: "99", messageId: 30, projectId: "test-project" }],
    ]);

    const handled = await tryHandleOwnerQuestionReply({
      token: "tok",
      chatId: 1234,
      replyToMessageId: 30,
      text: "approve",
      pending,
      allowedChatIds: [99],
      log: stubLog,
    });

    expect(handled).toBe(false);
    expect(mockOwnerAnswer).not.toHaveBeenCalled();
    expect(mockedCallTelegramApi).not.toHaveBeenCalled();
    expect(pending.has("oq-free-form")).toBe(true);
  });

  it("releases the binding and falls through when the question was already resolved by another surface", async () => {
    mockOwnerAnswer.mockReturnValue(null);
    const pending: Map<string, PendingMessage> = new Map([
      ["oq-free-form", { chatId: "99", messageId: 30, projectId: "test-project" }],
    ]);

    const handled = await tryHandleOwnerQuestionReply({
      token: "tok",
      chatId: 99,
      replyToMessageId: 30,
      text: "late reply",
      pending,
      allowedChatIds: [99],
      log: stubLog,
    });

    expect(handled).toBe(false);
    expect(mockOwnerAnswer).toHaveBeenCalledWith(
      "oq-free-form",
      "late reply",
      "telegram-reply",
    );
    expect(mockedCallTelegramApi).not.toHaveBeenCalled();
    expect(pending.has("oq-free-form")).toBe(false);
  });
});
