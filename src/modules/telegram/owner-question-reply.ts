/**
 * Shared owner-question resolution helpers used by both the inline-keyboard
 * callback path and the chat-reply path.
 *
 * Both paths resolve through the same `OwnerQuestionQueue` API; the only
 * differences are the trigger surface (callback_query vs message
 * reply_to_message) and the source label they record.
 */

import { getOwnerQuestionQueue } from "#core/daemon/owner-question-queue.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import type { KotaClient } from "#core/server/kota-client.js";
import { callTelegramApi } from "./client.js";

export type PendingMessage = {
  chatId: string;
  messageId: number;
  projectId: string;
  proposedAnswers?: string[];
};

export async function editResolvedOwnerQuestionMessage(
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

/**
 * Resolve a pending owner question via Telegram chat reply.
 *
 * Returns `true` if the bot's text-message poll should treat this message as
 * consumed (no fall-through to the interactive session). Returns `false` for
 * disallowed chats, untracked replies, and races where the question was
 * already resolved by another surface — those should fall through so the
 * bot's normal message handling decides what to do.
 */
export async function tryHandleOwnerQuestionReply(args: {
  token: string;
  chatId: number;
  replyToMessageId: number;
  text: string;
  pending: Map<string, PendingMessage>;
  allowedChatIds: number[] | undefined;
  log: ModuleContext["log"];
  client?: KotaClient;
}): Promise<boolean> {
  if (
    args.allowedChatIds?.length &&
    !args.allowedChatIds.includes(args.chatId)
  ) {
    return false;
  }

  let questionId: string | null = null;
  for (const [id, entry] of args.pending) {
    if (
      entry.messageId === args.replyToMessageId &&
      entry.chatId === String(args.chatId)
    ) {
      questionId = id;
      break;
    }
  }
  if (!questionId) return false;

  const info = args.pending.get(questionId);
  if (!info) return false;
  const mutate = args.client
    ? await args.client.forProject(info.projectId).ownerQuestions.answer(questionId, args.text)
    : (() => {
        const resolved = getOwnerQuestionQueue().answer(questionId, args.text, "telegram-reply");
        return resolved
          ? { ok: true as const, question: resolved }
          : { ok: false as const, reason: "not_found" as const };
      })();
  if (!mutate.ok) {
    args.pending.delete(questionId);
    return false;
  }

  await editResolvedOwnerQuestionMessage(
    args.token,
    questionId,
    "answer",
    mutate.question,
    args.pending,
  );
  return true;
}
