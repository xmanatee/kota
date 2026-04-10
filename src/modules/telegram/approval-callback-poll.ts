/**
 * Telegram inline-keyboard callback poll for approval requests.
 *
 * Polls for callback_query updates (Approve / Reject button presses) and
 * routes them to the approval queue. Uses allowed_updates: ["callback_query"]
 * so this poll does not consume message updates that the status-poll or bot
 * may be listening for.
 */

import type { ModuleContext } from "../../core/modules/module-types.js";
import { getApprovalQueue } from "../approval-queue/index.js";
import type { TelegramCallbackQuery } from "./client.js";
import { callTelegramApi } from "./client.js";

const POLL_TIMEOUT_S = 30;
const ERROR_BACKOFF_MS = 5_000;

export type PendingApprovalMessage = { chatId: string; messageId: number };

export function startApprovalCallbackPoll(
  token: string,
  pending: Map<string, PendingApprovalMessage>,
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

        const match = /^(approve|reject):(.+)$/.exec(cq.data);
        if (!match) continue;
        const action = match[1] as "approve" | "reject";
        const approvalId = match[2];

        const queue = getApprovalQueue();
        const resolved =
          action === "approve"
            ? queue.approve(approvalId, undefined, "telegram-inline")
            : queue.reject(approvalId, undefined, "telegram-inline");

        if (resolved) {
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
        } else {
          await callTelegramApi(token, "answerCallbackQuery", {
            callback_query_id: cq.id,
            text: "Approval already resolved or not found.",
            show_alert: true,
          }).catch(() => {});
        }
      }
    } catch (err) {
      if (!running) return;
      log.warn(`Telegram approval callback poll error: ${(err as Error).message}`);
      await sleep(ERROR_BACKOFF_MS);
    }

    if (running) void poll();
  }

  void poll();

  return () => {
    running = false;
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
