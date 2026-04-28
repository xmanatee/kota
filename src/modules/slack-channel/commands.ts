/**
 * Slack-channel slash-command parsing and dispatch.
 *
 * Parses `/recall`, `/answer`, `/capture`, and the four
 * `/capture-to-{memory,knowledge,tasks,inbox}` twins from Slack DM text and
 * dispatches each through the cross-store seams on `ctx.client`. Replies use
 * the shared chat-channel renderers (`renderRecallHitsPlain`,
 * `renderAnswerReplyPlain`, `renderCaptureReplyPlain`) so a Slack reply body
 * matches the Telegram reply byte-for-byte for the same envelope.
 *
 * `parseSlackSlashCommand` returns null for free-form messages so the bot's
 * non-slash DM path keeps owning multi-turn agent conversations unchanged.
 */

import type {
  AnswerClient,
  CaptureClient,
  CaptureFilter,
  CaptureTarget,
  RecallClient,
} from "#core/server/kota-client.js";
import { renderAnswerReplyPlain } from "#modules/answer/render.js";
import { CAPTURE_TARGET_ORDER } from "#modules/capture/capture-types.js";
import { renderCaptureReplyPlain } from "#modules/capture/render.js";
import { renderRecallHitsPlain } from "#modules/recall/render.js";
import { callSlackApi, splitText } from "./client.js";

export type SlackCommandClients = {
  recall: RecallClient;
  answer: AnswerClient;
  capture: CaptureClient;
};

export type SlackParsedCommand = {
  /** Lowercased command head including the leading `/` (e.g. `/recall`). */
  command: string;
  /** Trimmed argument body, possibly empty. */
  body: string;
};

const SLASH_COMMAND_RE = /^(\/[A-Za-z][A-Za-z0-9-]*)(?:\s+([\s\S]*))?$/;
const BOT_MENTION_RE = /^<@[A-Z0-9]+>\s*/;

const CAPTURE_TO_COMMAND: Record<string, CaptureTarget> = {
  "/capture-to-memory": "memory",
  "/capture-to-knowledge": "knowledge",
  "/capture-to-tasks": "tasks",
  "/capture-to-inbox": "inbox",
};

/**
 * Parse a Slack DM into a slash command. Tolerates leading whitespace, a
 * leading bot mention prefix (e.g. `<@U12345> /recall foo`), and matches
 * the command head case-insensitively. Returns null for free-form
 * messages so the caller routes them to the per-user session unchanged.
 */
export function parseSlackSlashCommand(rawText: string): SlackParsedCommand | null {
  const stripped = rawText.replace(/^\s+/, "").replace(BOT_MENTION_RE, "");
  if (!stripped.startsWith("/")) return null;
  const match = SLASH_COMMAND_RE.exec(stripped);
  if (!match) return null;
  return { command: match[1].toLowerCase(), body: (match[2] ?? "").trim() };
}

async function postReply(
  token: string,
  channelId: string,
  text: string,
): Promise<void> {
  for (const chunk of splitText(text)) {
    await callSlackApi(token, "chat.postMessage", {
      channel: channelId,
      text: chunk,
    });
  }
}

async function handleRecall(
  token: string,
  channelId: string,
  body: string,
  recall: RecallClient,
): Promise<void> {
  if (body.length === 0) {
    await postReply(token, channelId, "Usage: /recall <query>");
    return;
  }
  const result = await recall.recall(body);
  if (!result.ok) {
    await postReply(
      token,
      channelId,
      "Cross-store recall is not configured: no contributors are registered.",
    );
    return;
  }
  if (result.hits.length === 0) {
    await postReply(token, channelId, "No matching items.");
    return;
  }
  await postReply(token, channelId, renderRecallHitsPlain(result.hits));
}

async function handleAnswer(
  token: string,
  channelId: string,
  body: string,
  answer: AnswerClient,
): Promise<void> {
  if (body.length === 0) {
    await postReply(token, channelId, "Usage: /answer <query>");
    return;
  }
  const result = await answer.answer(body);
  await postReply(token, channelId, renderAnswerReplyPlain(result));
}

async function handleCapture(
  token: string,
  channelId: string,
  body: string,
  target: CaptureTarget | undefined,
  capture: CaptureClient,
): Promise<void> {
  if (body.length === 0) {
    await postReply(
      token,
      channelId,
      renderCaptureReplyPlain({
        ok: false,
        reason: "ambiguous",
        suggestions: CAPTURE_TARGET_ORDER,
      }),
    );
    return;
  }
  const filter: CaptureFilter | undefined =
    target === undefined ? undefined : { target };
  const result = await capture.capture(body, filter);
  await postReply(token, channelId, renderCaptureReplyPlain(result));
}

/**
 * Dispatch a parsed slash command. Returns true when the command was
 * recognized and handled, false otherwise so the caller can decide whether
 * to swallow unknown `/foo` commands or fall through to session routing.
 *
 * Daemon-side errors propagate as thrown exceptions so the bot's existing
 * error path renders the typed message; this matches the Telegram bot's
 * one-to-one error surfacing.
 */
export async function dispatchSlackSlashCommand(args: {
  token: string;
  channelId: string;
  parsed: SlackParsedCommand;
  clients: SlackCommandClients;
}): Promise<boolean> {
  const { token, channelId, parsed, clients } = args;
  switch (parsed.command) {
    case "/recall":
      await handleRecall(token, channelId, parsed.body, clients.recall);
      return true;
    case "/answer":
      await handleAnswer(token, channelId, parsed.body, clients.answer);
      return true;
    case "/capture":
      await handleCapture(
        token,
        channelId,
        parsed.body,
        undefined,
        clients.capture,
      );
      return true;
  }
  const captureTarget = CAPTURE_TO_COMMAND[parsed.command];
  if (captureTarget !== undefined) {
    await handleCapture(
      token,
      channelId,
      parsed.body,
      captureTarget,
      clients.capture,
    );
    return true;
  }
  return false;
}
