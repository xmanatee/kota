import type { AnswerClient } from "./client.js";
import { renderAnswerHistoryEntriesPlain, renderAnswerReplyPlain } from "./render.js";

// Callers supply the selected scope's client and a parsed, trimmed command body.
// Transport errors propagate to the channel's existing error handling.
export async function answerCommandReply(answer: AnswerClient, query: string): Promise<string> {
  if (!query) return "Usage: /answer <query>";
  return renderAnswerReplyPlain(await answer.answer(query));
}

export async function answerLogCommandReply(answer: AnswerClient, body: string): Promise<string> {
  let limit = 5;
  if (body.length > 0) {
    const parsed = Number.parseInt(body, 10);
    if (!Number.isFinite(parsed) || parsed <= 0 || String(parsed) !== body) {
      return "Usage: /answer-log [N]";
    }
    limit = parsed;
  }
  const result = await answer.log({ limit });
  return result.entries.length === 0
    ? "No past answer records yet."
    : renderAnswerHistoryEntriesPlain(result.entries);
}

export async function answerShowCommandReply(answer: AnswerClient, id: string): Promise<string> {
  if (!id) return "Usage: /answer-show <id>";
  const result = await answer.show(id);
  return result.ok
    ? renderAnswerReplyPlain(result.record.result)
    : `No answer record found for id "${id}".`;
}
