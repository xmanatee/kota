import type { ApprovalClientProjection } from "#core/daemon/approval-queue.js";
import type { BusEvents } from "#core/events/event-bus.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import { buildApprovalCallbackData } from "./approval-callback.js";
import type { TelegramMessage } from "./client.js";
import { callTelegramApi } from "./client.js";
import type { TelegramScopeSelection } from "./scope-selection.js";

export async function sendTelegramMessage(
  token: string,
  chatId: string,
  text: string,
  log: ModuleContext["log"],
): Promise<void> {
  void callTelegramApi(token, "sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "Markdown",
  }).catch((err) => {
    log.warn(`Failed to send Telegram message: ${(err as Error).message}`);
  });
}

export function eventScopeId(payload: object): string | undefined {
  return "scopeId" in payload && typeof payload.scopeId === "string"
    ? payload.scopeId
    : undefined;
}

export async function sendTelegramScopeMessage(
  token: string,
  chatId: string,
  text: string,
  scopeId: string | undefined,
  scopeSelection: TelegramScopeSelection | undefined,
  log: ModuleContext["log"],
): Promise<void> {
  const prefix = await renderScopeLabelPrefix(scopeId, scopeSelection, log);
  await sendTelegramMessage(token, chatId, `${prefix}${text}`, log);
}

export async function renderScopeLabelPrefix(
  scopeId: string | undefined,
  scopeSelection: TelegramScopeSelection | undefined,
  log: ModuleContext["log"],
): Promise<string> {
  if (!scopeId || !scopeSelection) return "";
  try {
    return await scopeSelection.renderScopeLabelPrefix(scopeId);
  } catch (err) {
    log.warn(`Telegram scope label unavailable: ${(err as Error).message}`);
    return "";
  }
}

export type InlineButton = { text: string; callback_data: string };

export function buildOwnerQuestionKeyboard(
  id: string,
  proposedAnswers: string[],
): InlineButton[][] {
  const rows: InlineButton[][] = [];
  for (let i = 0; i < proposedAnswers.length; i += 2) {
    const row: InlineButton[] = [
      { text: proposedAnswers[i], callback_data: `answer:${id}:${i}` },
    ];
    if (i + 1 < proposedAnswers.length) {
      row.push({
        text: proposedAnswers[i + 1],
        callback_data: `answer:${id}:${i + 1}`,
      });
    }
    rows.push(row);
  }
  rows.push([{ text: "Dismiss", callback_data: `dismiss:${id}` }]);
  return rows;
}

export type OwnerQuestionAskedPayload = BusEvents["owner.question.asked"];

export function ownerQuestionBehaviorText(value: OwnerQuestionAskedPayload["answerBehavior"] | undefined): string {
  if (value === "workflow-resume") {
    return "Answer resumes the waiting workflow.";
  }
  if (value === "record-only") {
    return "Answer is recorded only; no suspended workflow resumes.";
  }
  return "Answer behavior not recorded.";
}

export function compactOwnerQuestionContext(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value.trim() === "") return null;
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > 240 ? `${compact.slice(0, 237)}...` : compact;
}

export function ownerQuestionOriginLines(origin: OwnerQuestionAskedPayload["origin"] | undefined): string[] {
  if (!origin) return ["Origin: not recorded"];
  if (origin.kind === "workflow") {
    return [
      `Workflow: ${origin.workflowName}`,
      `Run: \`${origin.runId}\``,
      `Task: ${origin.taskId ?? "not recorded"}`,
    ];
  }
  if (origin.kind === "session") {
    return [`Session: \`${origin.sessionId ?? "not recorded"}\``];
  }
  return [`Origin: ${origin.source}`];
}

export async function sendOwnerQuestionMessage(
  token: string,
  chatId: string,
  id: string,
  question: string,
  reason: string,
  source: string,
  context: string | null,
  answerBehavior: OwnerQuestionAskedPayload["answerBehavior"] | undefined,
  origin: OwnerQuestionAskedPayload["origin"] | undefined,
  proposedAnswers: string[],
  scopeLabelPrefix: string,
  log: ModuleContext["log"],
): Promise<number | null> {
  const text = [
    `${scopeLabelPrefix}Owner question from *${source}*`,
    ...ownerQuestionOriginLines(origin),
    `Behavior: ${ownerQuestionBehaviorText(answerBehavior)}`,
    `Reason: ${reason}`,
    `Question: ${question}`,
    context ? `Context: ${context}` : null,
    `ID: \`${id}\``,
    ``,
    `kota owner-question show ${id}`,
    `kota owner-question answer ${id} <your answer>`,
    `kota owner-question dismiss ${id}`,
  ].filter((line): line is string => line !== null).join("\n");
  try {
    const msg = await callTelegramApi<TelegramMessage>(token, "sendMessage", {
      chat_id: chatId,
      text,
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: buildOwnerQuestionKeyboard(id, proposedAnswers),
      },
    });
    return msg.message_id;
  } catch (err) {
    log.warn(`Failed to send Telegram owner-question message: ${(err as Error).message}`);
    return null;
  }
}
export async function sendApprovalMessage(
  token: string,
  chatId: string,
  approval: ApprovalClientProjection,
  scopeLabelPrefix: string,
  log: ModuleContext["log"],
): Promise<{ messageId: number; reviewDigest: string } | null> {
  if (approval.review.status !== "available") {
    await callTelegramApi<TelegramMessage>(token, "sendMessage", {
      chat_id: chatId,
      text: [
        `${scopeLabelPrefix}Approval required: ${approval.tool}`,
        `Risk: ${approval.risk}`,
        `Reason: ${approval.reason}`,
        "Input unavailable after daemon restart. Reject and retry the tool call.",
      ].join("\n"),
    }).catch((err) => {
      log.warn(`Failed to send Telegram approval message: ${(err as Error).message}`);
    });
    return null;
  }
  const text = [
    `${scopeLabelPrefix}Approval required: ${approval.tool}`,
    `Risk: ${approval.risk}`,
    `Reason: ${approval.reason}`,
    `Reviewed input: ${JSON.stringify(approval.review.input)}`,
    ...(approval.review.context !== undefined
      ? [`Conversation context: ${approval.review.context}`]
      : []),
    `Review digest: ${approval.review.digest}`,
    `ID: ${approval.id}`,
    ``,
    `kota approval approve ${approval.id}`,
    `kota approval reject ${approval.id}`,
  ].join("\n");
  try {
    const msg = await callTelegramApi<TelegramMessage>(token, "sendMessage", {
      chat_id: chatId,
      text,
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "✅ Approve",
              callback_data: buildApprovalCallbackData("approve", approval.review.digest),
            },
            {
              text: "❌ Reject",
              callback_data: buildApprovalCallbackData("reject", approval.review.digest),
            },
          ],
        ],
      },
    });
    return { messageId: msg.message_id, reviewDigest: approval.review.digest };
  } catch (err) {
    log.warn(`Failed to send Telegram approval message: ${(err as Error).message}`);
    return null;
  }
}
