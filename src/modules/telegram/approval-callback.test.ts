import { beforeEach, describe, expect, it, vi } from "vitest";
import type { KotaClient } from "#core/server/kota-client.js";
import {
  buildApprovalCallbackData,
  handleApprovalCallback,
  type PendingApprovalMessage,
  parseApprovalCallbackData,
  pendingApprovalMessageKey,
} from "./approval-callback.js";
import { callTelegramApi } from "./client.js";

vi.mock("./client.js", () => ({ callTelegramApi: vi.fn() }));

const approveLocal = vi.fn();
const rejectLocal = vi.fn();

vi.mock("#modules/approval-queue/local-client.js", () => ({
  buildLocalApprovalsClient: () => ({
    approve: approveLocal,
    reject: rejectLocal,
  }),
}));

describe("Telegram approval callback receipts", () => {
  beforeEach(() => {
    vi.mocked(callTelegramApi).mockReset().mockResolvedValue(undefined as never);
    approveLocal.mockReset();
    rejectLocal.mockReset();
  });

  it("refuses a stale message after an approval ID is reused", async () => {
    const oldDigest = "a".repeat(64);
    const currentDigest = "b".repeat(64);
    const callbackData = buildApprovalCallbackData("approve", oldDigest);
    expect(callbackData).toHaveLength(51);
    const parsed = parseApprovalCallbackData(callbackData);
    if (!parsed) throw new Error("Expected a valid approval callback receipt");

    approveLocal.mockResolvedValue({ ok: false, reason: "review_mismatch" });
    const pending: Map<string, PendingApprovalMessage> = new Map([
      [pendingApprovalMessageKey(99, 10), {
        approvalId: "reused-id",
        chatId: "99",
        messageId: 10,
        projectId: "test-project",
        reviewDigest: oldDigest,
      }],
      [pendingApprovalMessageKey(99, 11), {
        approvalId: "reused-id",
        chatId: "99",
        messageId: 11,
        projectId: "test-project",
        reviewDigest: currentDigest,
      }],
    ]);

    await handleApprovalCallback(
      "token",
      {
        id: "cq-stale",
        from: { id: 1, first_name: "Test" },
        message: {
          message_id: 10,
          chat: { id: 99, type: "private" },
          date: 0,
        },
        data: callbackData,
      },
      parsed.action,
      parsed.reviewReceipt,
      pending,
      undefined,
    );

    expect(approveLocal).toHaveBeenCalledWith(
      "reused-id",
      oldDigest,
      undefined,
      { projectId: "test-project" },
    );
    expect(callTelegramApi).toHaveBeenCalledWith("token", "answerCallbackQuery", {
      callback_query_id: "cq-stale",
      text: "Approval already resolved or not found.",
      show_alert: true,
    });
  });

  it("submits the message-bound full digest to the daemon client", async () => {
    const reviewDigest = "c".repeat(64);
    const callbackData = buildApprovalCallbackData("approve", reviewDigest);
    const parsed = parseApprovalCallbackData(callbackData);
    if (!parsed) throw new Error("Expected a valid approval callback receipt");
    const approve = vi.fn().mockResolvedValue({
      ok: true,
      approval: {
        tool: "bash",
        risk: "dangerous",
        reason: "Runs shell commands",
      },
      resolution: {
        kind: "tool_execution",
        execution: {
          status: "succeeded",
          output: { redacted: true, reason: "tool-io" },
        },
      },
    });
    const forProject = vi.fn(() => ({
      approvals: { approve, reject: vi.fn() },
    }));
    const client: KotaClient = { forProject } as never;
    const pending: Map<string, PendingApprovalMessage> = new Map([
      [pendingApprovalMessageKey(99, 12), {
        approvalId: "approval-id",
        chatId: "99",
        messageId: 12,
        projectId: "test-project",
        reviewDigest,
      }],
    ]);

    await handleApprovalCallback(
      "token",
      {
        id: "cq-current",
        from: { id: 1, first_name: "Test" },
        message: {
          message_id: 12,
          chat: { id: 99, type: "private" },
          date: 0,
        },
        data: callbackData,
      },
      parsed.action,
      parsed.reviewReceipt,
      pending,
      client,
    );

    expect(forProject).toHaveBeenCalledWith("test-project");
    expect(approve).toHaveBeenCalledWith("approval-id", reviewDigest);
    expect(pending).toHaveLength(0);
  });

  it("reports execution failure without claiming the approved tool succeeded", async () => {
    const reviewDigest = "d".repeat(64);
    const parsed = parseApprovalCallbackData(
      buildApprovalCallbackData("approve", reviewDigest),
    );
    if (!parsed) throw new Error("Expected a valid approval callback receipt");
    const approve = vi.fn().mockResolvedValue({
      ok: true,
      approval: {
        tool: "bash",
        risk: "dangerous",
        reason: "Runs shell commands",
      },
      resolution: {
        kind: "tool_execution",
        execution: {
          status: "failed",
          output: { redacted: true, reason: "tool-io" },
        },
      },
    });
    const client: KotaClient = {
      forProject: () => ({ approvals: { approve, reject: vi.fn() } }),
    } as never;
    const pending: Map<string, PendingApprovalMessage> = new Map([
      [pendingApprovalMessageKey(99, 13), {
        approvalId: "approval-failed",
        chatId: "99",
        messageId: 13,
        projectId: "test-project",
        reviewDigest,
      }],
    ]);

    await handleApprovalCallback(
      "token",
      {
        id: "cq-failed",
        from: { id: 1, first_name: "Test" },
        message: {
          message_id: 13,
          chat: { id: 99, type: "private" },
          date: 0,
        },
      },
      parsed.action,
      parsed.reviewReceipt,
      pending,
      client,
    );

    expect(callTelegramApi).toHaveBeenCalledWith("token", "answerCallbackQuery", {
      callback_query_id: "cq-failed",
      text: "Approved, but execution failed.",
    });
    expect(callTelegramApi).toHaveBeenCalledWith("token", "editMessageText", expect.objectContaining({
      text: expect.stringContaining("Approved; execution failed"),
    }));
  });
});
