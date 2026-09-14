/**
 * Slack-channel slash-command parsing and dispatch.
 *
 * Parses the same slash-command surface the Telegram channel exposes —
 * `/recall`, `/answer`, `/answer-log`, `/answer-show`, `/capture` (plus
 * the four `/capture-to-{memory,knowledge,tasks,inbox}` twins), the
 * four `/retract-{memory,knowledge,tasks,inbox}` correction commands,
 * the per-store semantic-search seams `/memory`, `/knowledge`, `/history`,
 * `/tasks`, and the on-demand `/attention` and `/digest` seams — from
 * Slack DM text and
 * dispatches each through the matching `KotaClient` namespace or
 * snapshot client. Replies use the same module-owned plain-text renderers
 * the Telegram channel uses so a Slack reply body matches the Telegram
 * reply byte-for-byte for the same envelope.
 *
 * `parseSlackSlashCommand` returns null for free-form messages so the bot's
 * non-slash DM path keeps owning multi-turn agent conversations unchanged.
 */

import { segmentMessage } from "#core/channels/segment-message.js";
import type { AnswerClient } from "#modules/answer/client.js";
import {
  answerCommandReply,
  answerLogCommandReply,
  answerShowCommandReply,
} from "#modules/answer/commands.js";
import type { CaptureClient, CaptureTarget } from "#modules/capture/client.js";
import { captureCommandReply } from "#modules/capture/commands.js";
import type { HistoryClient } from "#modules/history/client.js";
import { historyCommandReply } from "#modules/history/commands.js";
import type { KnowledgeClient } from "#modules/knowledge/client.js";
import { knowledgeCommandReply } from "#modules/knowledge/commands.js";
import type { MemoryClient } from "#modules/memory/client.js";
import { memoryCommandReply } from "#modules/memory/commands.js";
import type { RecallClient } from "#modules/recall/client.js";
import { recallCommandReply } from "#modules/recall/commands.js";
import type { RepoTasksClient } from "#modules/repo-tasks/client.js";
import { tasksCommandReply } from "#modules/repo-tasks/commands.js";
import type { RetractClient, RetractTarget } from "#modules/retract/client.js";
import { retractCommandReply } from "#modules/retract/commands.js";
import { callSlackApi, MAX_TEXT_LENGTH } from "./client.js";

/**
 * Read-only attention snapshot used by the `/attention` slash command.
 *
 * Wraps `renderOnDemandAttention` so the dispatcher reuses the existing
 * module-owned renderer the Telegram channel already calls, keeping the
 * Slack reply byte-identical to the Telegram reply for the same repo
 * state. The bot constructs this client from the channel's `scopeRoot`.
 */
export type AttentionSnapshotClient = { snapshot(): { text: string } };

/**
 * Read-only digest snapshot used by the `/digest` slash command.
 *
 * Wraps `renderOnDemandDigest` for the same reason `AttentionSnapshotClient`
 * wraps the attention renderer.
 */
export type DigestSnapshotClient = { snapshot(): { text: string } };

export type SlackCommandClients = {
  recall: RecallClient;
  answer: AnswerClient;
  capture: CaptureClient;
  retract: RetractClient;
  memory: Pick<MemoryClient, "search">;
  knowledge: Pick<KnowledgeClient, "search">;
  history: Pick<HistoryClient, "search">;
  tasks: Pick<RepoTasksClient, "search">;
  attention: AttentionSnapshotClient;
  digest: DigestSnapshotClient;
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

const RETRACT_COMMANDS: Record<string, RetractTarget> = {
  "/retract-memory": "memory",
  "/retract-knowledge": "knowledge",
  "/retract-tasks": "tasks",
  "/retract-inbox": "inbox",
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
  for (const chunk of segmentMessage(text, MAX_TEXT_LENGTH)) {
    await callSlackApi(token, "chat.postMessage", {
      channel: channelId,
      text: chunk,
    });
  }
}

async function handleAttention(
  token: string,
  channelId: string,
  attention: AttentionSnapshotClient,
): Promise<void> {
  const { text } = attention.snapshot();
  await postReply(token, channelId, text);
}

async function handleDigest(
  token: string,
  channelId: string,
  digest: DigestSnapshotClient,
): Promise<void> {
  const { text } = digest.snapshot();
  await postReply(token, channelId, text);
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
      await postReply(token, channelId, await recallCommandReply(clients.recall, parsed.body));
      return true;
    case "/answer":
      await postReply(token, channelId, await answerCommandReply(clients.answer, parsed.body));
      return true;
    case "/answer-log":
      await postReply(token, channelId, await answerLogCommandReply(clients.answer, parsed.body));
      return true;
    case "/answer-show":
      await postReply(token, channelId, await answerShowCommandReply(clients.answer, parsed.body));
      return true;
    case "/capture":
      await postReply(token, channelId, await captureCommandReply(clients.capture, parsed.body));
      return true;
    case "/memory":
      await postReply(token, channelId, await memoryCommandReply(clients.memory, parsed.body));
      return true;
    case "/knowledge":
      await postReply(token, channelId, await knowledgeCommandReply(clients.knowledge, parsed.body));
      return true;
    case "/history":
      await postReply(token, channelId, await historyCommandReply(clients.history, parsed.body));
      return true;
    case "/tasks":
      await postReply(token, channelId, await tasksCommandReply(clients.tasks, parsed.body));
      return true;
    case "/attention":
      await handleAttention(token, channelId, clients.attention);
      return true;
    case "/digest":
      await handleDigest(token, channelId, clients.digest);
      return true;
  }
  const captureTarget = CAPTURE_TO_COMMAND[parsed.command];
  if (captureTarget !== undefined) {
    await postReply(token, channelId, await captureCommandReply(clients.capture, parsed.body, captureTarget));
    return true;
  }
  const retractTarget = RETRACT_COMMANDS[parsed.command];
  if (retractTarget !== undefined) {
    await postReply(token, channelId, await retractCommandReply(clients.retract, retractTarget, parsed.body));
    return true;
  }
  return false;
}
