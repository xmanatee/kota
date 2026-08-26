/**
 * Telegram inline-keyboard callback poll for approvals and owner questions.
 *
 * Polls for callback_query updates with allowed_updates: ["callback_query"]
 * and routes each callback to the right queue by callback_data prefix:
 *
 *   approve:<review-receipt> | reject:<review-receipt> -> ApprovalQueue
 *   answer:<id>:<idx> | dismiss:<id> -> OwnerQuestionQueue
 *
 * A single loop serves both prefixes — Telegram cancels the older long-poll
 * when a second one starts on the same bot token, which drops updates.
 */

import { getOwnerQuestionQueue } from "#core/daemon/owner-question-queue.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import type { KotaClient } from "#root/client/kota-client.generated.js";
import {
  handleApprovalCallback,
  type PendingApprovalMessage,
  parseApprovalCallbackData,
} from "./approval-callback.js";
import type { TelegramCallbackQuery } from "./client.js";
import { callTelegramApi } from "./client.js";
import {
  editResolvedOwnerQuestionMessage,
  type PendingMessage,
} from "./owner-question-reply.js";
import { acquireTelegramPollingOwner } from "./polling-ownership.js";

export type { PendingApprovalMessage } from "./approval-callback.js";
export type { PendingMessage };
export type TelegramCallbackHandler = (callback: TelegramCallbackQuery) => Promise<boolean>;

const POLL_TIMEOUT_S = 30;
const ERROR_BACKOFF_MS = 5_000;

export function startCallbackPoll(
  token: string,
  pendingApprovals: Map<string, PendingApprovalMessage>,
  pendingOwnerQuestions: Map<string, PendingMessage>,
  log: ModuleContext["log"],
  client?: KotaClient,
): () => void {
  const releasePollingOwner = acquireTelegramPollingOwner(token, {
    owner: "telegram-callback",
    source: "legacy callback poll helper",
  });
  let running = true;
  let offset = 0;
  let controller: AbortController | null = null;
  const handleCallback = createTelegramCallbackHandler(
    token,
    pendingApprovals,
    pendingOwnerQuestions,
    client,
    log,
  );

  async function poll(): Promise<void> {
    if (!running) return;
    controller = new AbortController();
    try {
      const updates = await callTelegramApi<
        Array<{ update_id: number; callback_query?: TelegramCallbackQuery }>
      >(token, "getUpdates", {
        offset,
        timeout: POLL_TIMEOUT_S,
        allowed_updates: ["callback_query"],
      }, {
        signal: controller.signal,
      });

      for (const update of updates) {
        offset = update.update_id + 1;
        const cq = update.callback_query;
        if (cq) await handleCallback(cq);
      }
    } catch (err) {
      if (!running) return;
      log.warn(`Telegram callback poll error: ${(err as Error).message}`);
      await sleep(ERROR_BACKOFF_MS);
    } finally {
      controller = null;
    }

    if (running) void poll();
  }

  void poll();

  return () => {
    running = false;
    releasePollingOwner();
    controller?.abort();
    controller = null;
  };
}

export function createTelegramCallbackHandler(
  token: string,
  pendingApprovals: Map<string, PendingApprovalMessage>,
  pendingOwnerQuestions: Map<string, PendingMessage>,
  client?: KotaClient,
  log?: ModuleContext["log"],
): TelegramCallbackHandler {
  return async (cq) => {
    if (!cq.data) return false;

    const approvalCallback = parseApprovalCallbackData(cq.data);
    if (approvalCallback) {
      await handleApprovalCallback(
        token,
        cq,
        approvalCallback.action,
        approvalCallback.reviewReceipt,
        pendingApprovals,
        client,
        log,
      );
      return true;
    }

    const answerMatch = /^answer:([^:]+):(\d+)$/.exec(cq.data);
    if (answerMatch) {
      await handleOwnerAnswerCallback(
        token,
        cq,
        answerMatch[1],
        Number.parseInt(answerMatch[2], 10),
        pendingOwnerQuestions,
        client,
        log,
      );
      return true;
    }

    const dismissMatch = /^dismiss:(.+)$/.exec(cq.data);
    if (dismissMatch) {
      await handleOwnerDismissCallback(
        token,
        cq,
        dismissMatch[1],
        pendingOwnerQuestions,
        client,
        log,
      );
      return true;
    }

    return false;
  };
}

async function handleOwnerAnswerCallback(
  token: string,
  cq: TelegramCallbackQuery,
  questionId: string,
  answerIdx: number,
  pending: Map<string, PendingMessage>,
  client: KotaClient | undefined,
  log?: ModuleContext["log"],
): Promise<void> {
  const info = pending.get(questionId);
  const item = client
    ? info
      ? { status: "pending" as const, proposedAnswers: info.proposedAnswers ?? [] }
      : null
    : getOwnerQuestionQueue().get(questionId);
  if (!item || item.status !== "pending") {
    await callTelegramApi(token, "answerCallbackQuery", {
      callback_query_id: cq.id,
      text: "Question already resolved or not found.",
      show_alert: true,
    }).catch((error) => reportCallbackFailure("answerCallbackQuery", error, log));
    return;
  }
  const answers = item.proposedAnswers ?? [];
  if (answerIdx < 0 || answerIdx >= answers.length) {
    await callTelegramApi(token, "answerCallbackQuery", {
      callback_query_id: cq.id,
      text: "Invalid answer selection.",
      show_alert: true,
    }).catch((error) => reportCallbackFailure("answerCallbackQuery", error, log));
    return;
  }
  const answerText = answers[answerIdx];
  const mutate = client
    ? info
      ? await client.forScope(info.scopeId).ownerQuestions.answer(questionId, answerText)
      : { ok: false as const, reason: "not_found" as const }
    : (() => {
        const resolved = getOwnerQuestionQueue().answer(questionId, answerText, "telegram-inline");
        return resolved
          ? { ok: true as const, question: resolved }
          : { ok: false as const, reason: "not_found" as const };
      })();
  if (!mutate.ok) {
    await callTelegramApi(token, "answerCallbackQuery", {
      callback_query_id: cq.id,
      text: "Question already resolved or not found.",
      show_alert: true,
    }).catch((error) => reportCallbackFailure("answerCallbackQuery", error, log));
    return;
  }

  await callTelegramApi(token, "answerCallbackQuery", {
    callback_query_id: cq.id,
    text: `Answered: ${answerText}`,
  }).catch((error) => reportCallbackFailure("answerCallbackQuery", error, log));

  await editResolvedOwnerQuestionMessage(
    token,
    questionId,
    "answer",
    mutate.question,
    pending,
    log,
  );
}

async function handleOwnerDismissCallback(
  token: string,
  cq: TelegramCallbackQuery,
  questionId: string,
  pending: Map<string, PendingMessage>,
  client: KotaClient | undefined,
  log?: ModuleContext["log"],
): Promise<void> {
  const info = pending.get(questionId);
  const mutate = client
    ? info
      ? await client.forScope(info.scopeId).ownerQuestions.dismiss(questionId)
      : { ok: false as const, reason: "not_found" as const }
    : (() => {
        const resolved = getOwnerQuestionQueue().dismiss(questionId, undefined, "telegram-inline");
        return resolved
          ? { ok: true as const, question: resolved }
          : { ok: false as const, reason: "not_found" as const };
      })();
  if (!mutate.ok) {
    await callTelegramApi(token, "answerCallbackQuery", {
      callback_query_id: cq.id,
      text: "Question already resolved or not found.",
      show_alert: true,
    }).catch((error) => reportCallbackFailure("answerCallbackQuery", error, log));
    return;
  }

  await callTelegramApi(token, "answerCallbackQuery", {
    callback_query_id: cq.id,
    text: "Dismissed.",
  }).catch((error) => reportCallbackFailure("answerCallbackQuery", error, log));

  await editResolvedOwnerQuestionMessage(
    token,
    questionId,
    "dismiss",
    mutate.question,
    pending,
    log,
  );
}

function reportCallbackFailure(
  method: string,
  error: Error,
  log?: ModuleContext["log"],
): void {
  if (log === undefined) throw error;
  log.warn(`Telegram ${method} failed: ${error.message}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
