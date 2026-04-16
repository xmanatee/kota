/**
 * Telegram inline-keyboard callback poll for approvals and owner questions.
 *
 * Polls for callback_query updates with allowed_updates: ["callback_query"]
 * and routes each callback to the right queue by callback_data prefix:
 *
 *   approve:<id> | reject:<id>       -> ApprovalQueue
 *   answer:<id>:<idx> | dismiss:<id> -> OwnerQuestionQueue
 *
 * A single loop serves both prefixes — Telegram cancels the older long-poll
 * when a second one starts on the same bot token, which drops updates.
 */

import { getOwnerQuestionQueue } from "#core/daemon/owner-question-queue.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import { getApprovalQueue } from "#modules/approval-queue/index.js";
import type { TelegramCallbackQuery } from "./client.js";
import { callTelegramApi } from "./client.js";

const POLL_TIMEOUT_S = 30;
const ERROR_BACKOFF_MS = 5_000;

export type PendingMessage = { chatId: string; messageId: number };

export function startCallbackPoll(
  token: string,
  pendingApprovals: Map<string, PendingMessage>,
  pendingOwnerQuestions: Map<string, PendingMessage>,
  log: ModuleContext["log"],
): () => void {
  let running = true;
  let offset = 0;

  async function poll(): Promise<void> {
    if (!running) return;
    try {
      const updates = await callTelegramApi<
        Array<{ update_id: number; callback_query?: TelegramCallbackQuery }>
      >(token, "getUpdates", {
        offset,
        timeout: POLL_TIMEOUT_S,
        allowed_updates: ["callback_query"],
      });

      for (const update of updates) {
        offset = update.update_id + 1;
        const cq = update.callback_query;
        if (!cq?.data) continue;

        const approvalMatch = /^(approve|reject):(.+)$/.exec(cq.data);
        if (approvalMatch) {
          await handleApprovalCallback(
            token,
            cq,
            approvalMatch[1] as "approve" | "reject",
            approvalMatch[2],
            pendingApprovals,
          );
          continue;
        }

        const answerMatch = /^answer:([^:]+):(\d+)$/.exec(cq.data);
        if (answerMatch) {
          await handleOwnerAnswerCallback(
            token,
            cq,
            answerMatch[1],
            Number.parseInt(answerMatch[2], 10),
            pendingOwnerQuestions,
          );
          continue;
        }

        const dismissMatch = /^dismiss:(.+)$/.exec(cq.data);
        if (dismissMatch) {
          await handleOwnerDismissCallback(
            token,
            cq,
            dismissMatch[1],
            pendingOwnerQuestions,
          );
        }
      }
    } catch (err) {
      if (!running) return;
      log.warn(`Telegram callback poll error: ${(err as Error).message}`);
      await sleep(ERROR_BACKOFF_MS);
    }

    if (running) void poll();
  }

  void poll();

  return () => {
    running = false;
  };
}

async function handleApprovalCallback(
  token: string,
  cq: TelegramCallbackQuery,
  action: "approve" | "reject",
  approvalId: string,
  pending: Map<string, PendingMessage>,
): Promise<void> {
  const queue = getApprovalQueue();
  const resolved =
    action === "approve"
      ? queue.approve(approvalId, undefined, "telegram-inline")
      : queue.reject(approvalId, undefined, "telegram-inline");

  if (!resolved) {
    await callTelegramApi(token, "answerCallbackQuery", {
      callback_query_id: cq.id,
      text: "Approval already resolved or not found.",
      show_alert: true,
    }).catch(() => {});
    return;
  }

  const label = action === "approve" ? "✅ Approved" : "❌ Rejected";
  await callTelegramApi(token, "answerCallbackQuery", {
    callback_query_id: cq.id,
    text: action === "approve" ? "Approved!" : "Rejected!",
  }).catch(() => {});

  const info = pending.get(approvalId);
  if (info) {
    const editedText = [
      `${label}: *${resolved.tool}*`,
      `Risk: ${resolved.risk}`,
      `Reason: ${resolved.reason}`,
      `ID: \`${approvalId}\``,
      ``,
      `kota approval approve ${approvalId}`,
      `kota approval reject ${approvalId}`,
    ].join("\n");
    await callTelegramApi(token, "editMessageText", {
      chat_id: info.chatId,
      message_id: info.messageId,
      text: editedText,
      parse_mode: "Markdown",
    }).catch(() => {});
    pending.delete(approvalId);
  }
}

async function handleOwnerAnswerCallback(
  token: string,
  cq: TelegramCallbackQuery,
  questionId: string,
  answerIdx: number,
  pending: Map<string, PendingMessage>,
): Promise<void> {
  const queue = getOwnerQuestionQueue();
  const item = queue.get(questionId);
  if (!item || item.status !== "pending") {
    await callTelegramApi(token, "answerCallbackQuery", {
      callback_query_id: cq.id,
      text: "Question already resolved or not found.",
      show_alert: true,
    }).catch(() => {});
    return;
  }
  const answers = item.proposedAnswers ?? [];
  if (answerIdx < 0 || answerIdx >= answers.length) {
    await callTelegramApi(token, "answerCallbackQuery", {
      callback_query_id: cq.id,
      text: "Invalid answer selection.",
      show_alert: true,
    }).catch(() => {});
    return;
  }
  const answerText = answers[answerIdx];
  const resolved = queue.answer(questionId, answerText, "telegram-inline");
  if (!resolved) {
    await callTelegramApi(token, "answerCallbackQuery", {
      callback_query_id: cq.id,
      text: "Question already resolved or not found.",
      show_alert: true,
    }).catch(() => {});
    return;
  }

  await callTelegramApi(token, "answerCallbackQuery", {
    callback_query_id: cq.id,
    text: `Answered: ${answerText}`,
  }).catch(() => {});

  await editResolvedOwnerQuestionMessage(
    token,
    questionId,
    "answer",
    resolved,
    pending,
  );
}

async function handleOwnerDismissCallback(
  token: string,
  cq: TelegramCallbackQuery,
  questionId: string,
  pending: Map<string, PendingMessage>,
): Promise<void> {
  const queue = getOwnerQuestionQueue();
  const resolved = queue.dismiss(questionId, undefined, "telegram-inline");
  if (!resolved) {
    await callTelegramApi(token, "answerCallbackQuery", {
      callback_query_id: cq.id,
      text: "Question already resolved or not found.",
      show_alert: true,
    }).catch(() => {});
    return;
  }

  await callTelegramApi(token, "answerCallbackQuery", {
    callback_query_id: cq.id,
    text: "Dismissed.",
  }).catch(() => {});

  await editResolvedOwnerQuestionMessage(
    token,
    questionId,
    "dismiss",
    resolved,
    pending,
  );
}

async function editResolvedOwnerQuestionMessage(
  token: string,
  questionId: string,
  action: "answer" | "dismiss",
  resolved: { source: string; reason: string; question: string; answer?: string },
  pending: Map<string, PendingMessage>,
): Promise<void> {
  const info = pending.get(questionId);
  if (!info) return;
  const label = action === "answer" ? "✅ Answered" : "❌ Dismissed";
  const outcome =
    action === "answer" ? `Answer: ${resolved.answer ?? ""}` : "Dismissed";
  const editedText = [
    `${label}: owner question from *${resolved.source}*`,
    `Reason: ${resolved.reason}`,
    `Question: ${resolved.question}`,
    `ID: \`${questionId}\``,
    ``,
    outcome,
  ].join("\n");
  await callTelegramApi(token, "editMessageText", {
    chat_id: info.chatId,
    message_id: info.messageId,
    text: editedText,
    parse_mode: "Markdown",
  }).catch(() => {});
  pending.delete(questionId);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
