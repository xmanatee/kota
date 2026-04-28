/**
 * Slack-channel slash-command parsing and dispatch.
 *
 * Parses the same slash-command surface the Telegram channel exposes —
 * `/recall`, `/answer`, `/answer-log`, `/answer-show`, `/capture` (plus
 * the four `/capture-to-{memory,knowledge,tasks,inbox}` twins), the
 * per-store semantic-search seams `/memory`, `/knowledge`, `/history`,
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

import type {
  AnswerClient,
  CaptureClient,
  CaptureFilter,
  CaptureTarget,
  HistoryClient,
  KnowledgeClient,
  MemoryClient,
  RecallClient,
  RepoTasksClient,
} from "#core/server/kota-client.js";
import {
  renderAnswerHistoryEntriesPlain,
  renderAnswerReplyPlain,
} from "#modules/answer/render.js";
import { CAPTURE_TARGET_ORDER } from "#modules/capture/capture-types.js";
import { renderCaptureReplyPlain } from "#modules/capture/render.js";
import { renderHistorySearchPlain } from "#modules/history/render.js";
import { renderKnowledgeSearchPlain } from "#modules/knowledge/render.js";
import { renderMemorySearchPlain } from "#modules/memory/render.js";
import { renderRecallHitsPlain } from "#modules/recall/render.js";
import { renderRepoTaskSearchPlain } from "#modules/repo-tasks/render.js";
import { callSlackApi, splitText } from "./client.js";

/**
 * Read-only attention snapshot used by the `/attention` slash command.
 *
 * Wraps `renderOnDemandAttention` so the dispatcher reuses the existing
 * module-owned renderer the Telegram channel already calls, keeping the
 * Slack reply byte-identical to the Telegram reply for the same repo
 * state. The bot constructs this client from the channel's `projectDir`.
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
  memory: MemoryClient;
  knowledge: KnowledgeClient;
  history: HistoryClient;
  tasks: RepoTasksClient;
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

/** Default page size for the per-store semantic-search seams. Matches Telegram. */
const SEARCH_DEFAULT_LIMIT = 10;

/** Default page size for the `/answer-log` projection. Matches Telegram. */
const ANSWER_LOG_DEFAULT_LIMIT = 5;

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

async function handleAnswerLog(
  token: string,
  channelId: string,
  body: string,
  answer: AnswerClient,
): Promise<void> {
  let limit = ANSWER_LOG_DEFAULT_LIMIT;
  if (body.length > 0) {
    const parsed = Number.parseInt(body, 10);
    if (!Number.isFinite(parsed) || parsed <= 0 || String(parsed) !== body) {
      await postReply(token, channelId, "Usage: /answer-log [N]");
      return;
    }
    limit = parsed;
  }
  const result = await answer.log({ limit });
  if (result.entries.length === 0) {
    await postReply(token, channelId, "No past answer records yet.");
    return;
  }
  await postReply(token, channelId, renderAnswerHistoryEntriesPlain(result.entries));
}

async function handleAnswerShow(
  token: string,
  channelId: string,
  body: string,
  answer: AnswerClient,
): Promise<void> {
  if (body.length === 0) {
    await postReply(token, channelId, "Usage: /answer-show <id>");
    return;
  }
  const result = await answer.show(body);
  if (!result.ok) {
    await postReply(token, channelId, `No answer record found for id "${body}".`);
    return;
  }
  await postReply(token, channelId, renderAnswerReplyPlain(result.record.result));
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

async function handleMemory(
  token: string,
  channelId: string,
  body: string,
  memory: MemoryClient,
): Promise<void> {
  if (body.length === 0) {
    await postReply(token, channelId, "Usage: /memory <query>");
    return;
  }
  const result = await memory.search(body, {
    semantic: true,
    limit: SEARCH_DEFAULT_LIMIT,
  });
  if (!result.ok) {
    await postReply(
      token,
      channelId,
      "Semantic memory search requires an embedding-backed memory provider.",
    );
    return;
  }
  if (result.entries.length === 0) {
    await postReply(token, channelId, "No matching memory entries.");
    return;
  }
  await postReply(token, channelId, renderMemorySearchPlain(result.entries));
}

async function handleKnowledge(
  token: string,
  channelId: string,
  body: string,
  knowledge: KnowledgeClient,
): Promise<void> {
  if (body.length === 0) {
    await postReply(token, channelId, "Usage: /knowledge <query>");
    return;
  }
  const result = await knowledge.search(body, {
    semantic: true,
    limit: SEARCH_DEFAULT_LIMIT,
  });
  if (!result.ok) {
    await postReply(
      token,
      channelId,
      "Semantic knowledge search requires an embedding-backed knowledge provider.",
    );
    return;
  }
  if (result.entries.length === 0) {
    await postReply(token, channelId, "No matching knowledge entries.");
    return;
  }
  await postReply(token, channelId, renderKnowledgeSearchPlain(result.entries));
}

async function handleHistory(
  token: string,
  channelId: string,
  body: string,
  history: HistoryClient,
): Promise<void> {
  if (body.length === 0) {
    await postReply(token, channelId, "Usage: /history <query>");
    return;
  }
  const result = await history.search(body, {
    semantic: true,
    limit: SEARCH_DEFAULT_LIMIT,
  });
  if (!result.ok) {
    await postReply(
      token,
      channelId,
      "Semantic conversation search requires an embedding-backed history provider.",
    );
    return;
  }
  if (result.conversations.length === 0) {
    await postReply(token, channelId, "No matching conversations.");
    return;
  }
  await postReply(
    token,
    channelId,
    renderHistorySearchPlain(result.conversations),
  );
}

async function handleTasks(
  token: string,
  channelId: string,
  body: string,
  tasks: RepoTasksClient,
): Promise<void> {
  if (body.length === 0) {
    await postReply(token, channelId, "Usage: /tasks <query>");
    return;
  }
  const result = await tasks.search(body, {
    semantic: true,
    limit: SEARCH_DEFAULT_LIMIT,
  });
  if (!result.ok) {
    await postReply(
      token,
      channelId,
      "Semantic task search requires an embedding-backed repo-tasks provider.",
    );
    return;
  }
  if (result.tasks.length === 0) {
    await postReply(token, channelId, "No matching tasks.");
    return;
  }
  await postReply(token, channelId, renderRepoTaskSearchPlain(result.tasks));
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
      await handleRecall(token, channelId, parsed.body, clients.recall);
      return true;
    case "/answer":
      await handleAnswer(token, channelId, parsed.body, clients.answer);
      return true;
    case "/answer-log":
      await handleAnswerLog(token, channelId, parsed.body, clients.answer);
      return true;
    case "/answer-show":
      await handleAnswerShow(token, channelId, parsed.body, clients.answer);
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
    case "/memory":
      await handleMemory(token, channelId, parsed.body, clients.memory);
      return true;
    case "/knowledge":
      await handleKnowledge(token, channelId, parsed.body, clients.knowledge);
      return true;
    case "/history":
      await handleHistory(token, channelId, parsed.body, clients.history);
      return true;
    case "/tasks":
      await handleTasks(token, channelId, parsed.body, clients.tasks);
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
