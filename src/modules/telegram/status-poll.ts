import { join } from "node:path";
import type {
  AnswerClient,
  AnswerResult,
  HistoryClient,
  KnowledgeClient,
  MemoryClient,
  RecallClient,
  RepoTasksClient,
} from "#core/server/kota-client.js";
import type { WorkflowRuntimeState } from "#core/workflow/run-types.js";
import {
  renderAnswerCitationsPlain,
  renderAnswerHistoryEntriesPlain,
} from "#modules/answer/render.js";
import { computeCostByWorkflow, loadRecentRuns } from "#modules/autonomy/shared.js";
import { renderOnDemandAttention } from "#modules/autonomy/workflows/attention-digest/step.js";
import { renderOnDemandDigest } from "#modules/autonomy/workflows/daily-digest/on-demand.js";
import { renderHistorySearchPlain } from "#modules/history/render.js";
import { renderKnowledgeSearchPlain } from "#modules/knowledge/render.js";
import { renderMemorySearchPlain } from "#modules/memory/render.js";
import { renderRecallHitsPlain } from "#modules/recall/render.js";
import { renderRepoTaskSearchPlain } from "#modules/repo-tasks/render.js";
import { callTelegramApi, splitMessage } from "./client.js";

const POLL_INTERVAL_MS = 30_000;
const ERROR_BACKOFF_MS = 5_000;
/** Telegram sendMessage hard limit; longer bodies must be truncated client-side. */
const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;
/** Default page size for the chat-side `/answer-log` projection. */
const ANSWER_LOG_DEFAULT_LIMIT = 5;

export type StatusInfo = {
  runtimeState: WorkflowRuntimeState;
  dispatchPaused: boolean;
  runsDir: string;
};

export function buildStatusText({ runtimeState, dispatchPaused, runsDir }: StatusInfo): string {
  const activeRuns = runtimeState.activeRuns ?? [];

  let dispatchStatus: string;
  if (dispatchPaused) {
    dispatchStatus = "paused";
  } else if (activeRuns.length > 0) {
    dispatchStatus = "active";
  } else {
    dispatchStatus = "idle";
  }

  const lines: string[] = [`*Dispatch:* ${dispatchStatus}`];

  for (const run of activeRuns) {
    lines.push(`*Active run:* \`${run.runId}\` (${run.workflow})`);
  }

  const runs = loadRecentRuns(runsDir);
  const costByWorkflow = computeCostByWorkflow(runs);
  const totalCost = Object.values(costByWorkflow).reduce((a, b) => a + b, 0);
  lines.push(`*Today's spend:* $${totalCost.toFixed(4)}`);

  const workflowEntries = Object.entries(runtimeState.workflows).filter(
    ([, entry]) => entry.lastCompletion != null,
  );
  if (workflowEntries.length > 0) {
    lines.push("*Last status:*");
    for (const [name, entry] of workflowEntries) {
      lines.push(`  ${name}: ${entry.lastCompletion!.status}`);
    }
  }

  return lines.join("\n");
}

/**
 * Plain-text reply for the `/answer` chat command. Exhaustively covers
 * the typed `AnswerResult` discriminated union — `ok: true` plus the
 * three `ok: false` reasons — with no `default` branch, so a future
 * additional reason cannot silently fall through to a happy-path render.
 * The success branch lays out the synthesized prose first (markers
 * preserved inline) followed by a labeled citation block sharing the
 * `renderAnswerCitationsPlain` helper that the CLI surface uses.
 */
const ANSWER_FAILURE_BODY: Record<
  Extract<AnswerResult, { ok: false }>["reason"],
  string
> = {
  no_hits: "No matching sources across the second brain — nothing to synthesize.",
  semantic_unavailable: "Cross-store recall has no registered contributors.",
  synthesis_failed:
    "Synthesis failed (model unreachable or unable to cite resolvable sources).",
};

export function renderAnswerReplyPlain(result: AnswerResult): string {
  if (result.ok) {
    const citationsBlock = renderAnswerCitationsPlain(result.citations, result.hits);
    if (citationsBlock === "") return result.answer;
    return `${result.answer}\n\nCitations\n${citationsBlock}`;
  }
  switch (result.reason) {
    case "no_hits":
      return ANSWER_FAILURE_BODY.no_hits;
    case "semantic_unavailable":
      return ANSWER_FAILURE_BODY.semantic_unavailable;
    case "synthesis_failed":
      return ANSWER_FAILURE_BODY.synthesis_failed;
  }
}

function truncateForTelegram(body: string): string {
  if (body.length <= TELEGRAM_MAX_MESSAGE_LENGTH) return body;
  const suffix = "\n…(truncated)";
  return `${body.slice(0, TELEGRAM_MAX_MESSAGE_LENGTH - suffix.length)}${suffix}`;
}

export function startTelegramStatusPoll(
  token: string,
  chatId: string,
  projectDir: string,
  getStatusInfo: () => StatusInfo,
  knowledge: KnowledgeClient,
  memory: MemoryClient,
  history: HistoryClient,
  tasks: RepoTasksClient,
  recall: RecallClient,
  answer: AnswerClient,
  log?: (message: string) => void,
): () => void {
  let running = true;
  let offset = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  async function handleStatus(): Promise<void> {
    const text = buildStatusText(getStatusInfo());
    await callTelegramApi(token, "sendMessage", {
      chat_id: chatId,
      text,
      parse_mode: "Markdown",
    });
  }

  async function handleDigest(): Promise<void> {
    const { text } = renderOnDemandDigest({ projectDir });
    await callTelegramApi(token, "sendMessage", {
      chat_id: chatId,
      // Plain text — the rendered digest contains underscores, parentheses,
      // and backticks that would require Markdown escaping.
      text: truncateForTelegram(text),
    });
  }

  async function handleAttention(): Promise<void> {
    const runsDir = join(projectDir, ".kota", "runs");
    const { text } = renderOnDemandAttention({ projectDir, runsDir });
    await callTelegramApi(token, "sendMessage", {
      chat_id: chatId,
      // Plain text — the rendered attention body uses bullet glyphs and
      // *bold* markers that would require Markdown escaping.
      text: truncateForTelegram(text),
    });
  }

  async function handleKnowledge(text: string): Promise<void> {
    const query =
      text === "/knowledge" ? "" : text.slice("/knowledge ".length).trim();
    if (query.length === 0) {
      await callTelegramApi(token, "sendMessage", {
        chat_id: chatId,
        text: "Usage: /knowledge <query>",
      });
      return;
    }
    const result = await knowledge.search(query, { semantic: true, limit: 10 });
    if (!result.ok) {
      await callTelegramApi(token, "sendMessage", {
        chat_id: chatId,
        text: "Semantic knowledge search requires an embedding-backed knowledge provider.",
      });
      return;
    }
    if (result.entries.length === 0) {
      await callTelegramApi(token, "sendMessage", {
        chat_id: chatId,
        text: "No matching knowledge entries.",
      });
      return;
    }
    await callTelegramApi(token, "sendMessage", {
      chat_id: chatId,
      // Plain text — knowledge titles can carry Markdown-active characters
      // that would require escaping if Markdown parse_mode were enabled.
      text: truncateForTelegram(renderKnowledgeSearchPlain(result.entries)),
    });
  }

  async function handleMemory(text: string): Promise<void> {
    const query =
      text === "/memory" ? "" : text.slice("/memory ".length).trim();
    if (query.length === 0) {
      await callTelegramApi(token, "sendMessage", {
        chat_id: chatId,
        text: "Usage: /memory <query>",
      });
      return;
    }
    const result = await memory.search(query, { semantic: true, limit: 10 });
    if (!result.ok) {
      await callTelegramApi(token, "sendMessage", {
        chat_id: chatId,
        text: "Semantic memory search requires an embedding-backed memory provider.",
      });
      return;
    }
    if (result.entries.length === 0) {
      await callTelegramApi(token, "sendMessage", {
        chat_id: chatId,
        text: "No matching memory entries.",
      });
      return;
    }
    await callTelegramApi(token, "sendMessage", {
      chat_id: chatId,
      // Plain text — memory content can carry Markdown-active characters
      // that would require escaping if Markdown parse_mode were enabled.
      text: truncateForTelegram(renderMemorySearchPlain(result.entries)),
    });
  }

  async function handleHistory(text: string): Promise<void> {
    const query =
      text === "/history" ? "" : text.slice("/history ".length).trim();
    if (query.length === 0) {
      await callTelegramApi(token, "sendMessage", {
        chat_id: chatId,
        text: "Usage: /history <query>",
      });
      return;
    }
    const result = await history.search(query, { semantic: true, limit: 10 });
    if (!result.ok) {
      await callTelegramApi(token, "sendMessage", {
        chat_id: chatId,
        text: "Semantic conversation search requires an embedding-backed history provider.",
      });
      return;
    }
    if (result.conversations.length === 0) {
      await callTelegramApi(token, "sendMessage", {
        chat_id: chatId,
        text: "No matching conversations.",
      });
      return;
    }
    await callTelegramApi(token, "sendMessage", {
      chat_id: chatId,
      // Plain text — conversation titles can carry Markdown-active
      // characters that would require escaping if Markdown parse_mode
      // were enabled.
      text: truncateForTelegram(renderHistorySearchPlain(result.conversations)),
    });
  }

  async function handleRecall(text: string): Promise<void> {
    const query =
      text === "/recall" ? "" : text.slice("/recall ".length).trim();
    if (query.length === 0) {
      await callTelegramApi(token, "sendMessage", {
        chat_id: chatId,
        text: "Usage: /recall <query>",
      });
      return;
    }
    const result = await recall.recall(query);
    if (!result.ok) {
      await callTelegramApi(token, "sendMessage", {
        chat_id: chatId,
        text: "Cross-store recall is not configured: no contributors are registered.",
      });
      return;
    }
    if (result.hits.length === 0) {
      await callTelegramApi(token, "sendMessage", {
        chat_id: chatId,
        text: "No matching items.",
      });
      return;
    }
    await callTelegramApi(token, "sendMessage", {
      chat_id: chatId,
      // Plain text — recall hits carry titles/previews from every store and
      // can include Markdown-active characters that would require escaping
      // if Markdown parse_mode were enabled.
      text: truncateForTelegram(renderRecallHitsPlain(result.hits)),
    });
  }

  async function handleAnswer(text: string): Promise<void> {
    const query =
      text === "/answer" ? "" : text.slice("/answer ".length).trim();
    if (query.length === 0) {
      await callTelegramApi(token, "sendMessage", {
        chat_id: chatId,
        text: "Usage: /answer <query>",
      });
      return;
    }
    const result = await answer.answer(query);
    await callTelegramApi(token, "sendMessage", {
      chat_id: chatId,
      // Plain text — the synthesized prose can carry Markdown-active
      // characters and bracketed `[source:id]` markers that would require
      // escaping if Markdown parse_mode were enabled.
      text: truncateForTelegram(renderAnswerReplyPlain(result)),
    });
  }

  async function handleAnswerLog(text: string): Promise<void> {
    const arg =
      text === "/answer-log" ? "" : text.slice("/answer-log ".length).trim();
    let limit = ANSWER_LOG_DEFAULT_LIMIT;
    if (arg.length > 0) {
      const parsed = Number.parseInt(arg, 10);
      if (!Number.isFinite(parsed) || parsed <= 0 || String(parsed) !== arg) {
        await callTelegramApi(token, "sendMessage", {
          chat_id: chatId,
          text: "Usage: /answer-log [N]",
        });
        return;
      }
      limit = parsed;
    }
    const result = await answer.log({ limit });
    if (result.entries.length === 0) {
      await callTelegramApi(token, "sendMessage", {
        chat_id: chatId,
        text: "No past answer records yet.",
      });
      return;
    }
    await callTelegramApi(token, "sendMessage", {
      chat_id: chatId,
      // Plain text — entry queries can carry Markdown-active characters
      // and the rendered row deliberately reuses the CLI's plain layout.
      text: truncateForTelegram(renderAnswerHistoryEntriesPlain(result.entries)),
    });
  }

  async function handleAnswerShow(text: string): Promise<void> {
    const id =
      text === "/answer-show" ? "" : text.slice("/answer-show ".length).trim();
    if (id.length === 0) {
      await callTelegramApi(token, "sendMessage", {
        chat_id: chatId,
        text: "Usage: /answer-show <id>",
      });
      return;
    }
    const result = await answer.show(id);
    if (!result.ok) {
      await callTelegramApi(token, "sendMessage", {
        chat_id: chatId,
        text: `No answer record found for id "${id}".`,
      });
      return;
    }
    // Re-render byte-identically to /answer's reply by feeding the typed
    // record's discriminated `result` back through the same renderer.
    const body = renderAnswerReplyPlain(result.record.result);
    // /answer-show may emit a long body with many citations; chunk on
    // the shared splitter rather than truncating mid-citation.
    for (const chunk of splitMessage(body)) {
      await callTelegramApi(token, "sendMessage", {
        chat_id: chatId,
        text: chunk,
      });
    }
  }

  async function handleTasks(text: string): Promise<void> {
    const query =
      text === "/tasks" ? "" : text.slice("/tasks ".length).trim();
    if (query.length === 0) {
      await callTelegramApi(token, "sendMessage", {
        chat_id: chatId,
        text: "Usage: /tasks <query>",
      });
      return;
    }
    const result = await tasks.search(query, { semantic: true, limit: 10 });
    if (!result.ok) {
      await callTelegramApi(token, "sendMessage", {
        chat_id: chatId,
        text: "Semantic task search requires an embedding-backed repo-tasks provider.",
      });
      return;
    }
    if (result.tasks.length === 0) {
      await callTelegramApi(token, "sendMessage", {
        chat_id: chatId,
        text: "No matching tasks.",
      });
      return;
    }
    await callTelegramApi(token, "sendMessage", {
      chat_id: chatId,
      // Plain text — task titles can carry Markdown-active characters that
      // would require escaping if Markdown parse_mode were enabled.
      text: truncateForTelegram(renderRepoTaskSearchPlain(result.tasks)),
    });
  }

  async function poll(): Promise<void> {
    if (!running) return;
    try {
      const updates = await callTelegramApi<
        Array<{
          update_id: number;
          message?: { chat: { id: number }; text?: string };
        }>
      >(token, "getUpdates", {
        offset,
        timeout: 0,
        allowed_updates: ["message"],
      });

      for (const update of updates) {
        offset = update.update_id + 1;
        const msg = update.message;
        if (!msg?.text) continue;
        if (String(msg.chat.id) !== chatId) continue;

        if (msg.text === "/status") {
          await handleStatus();
        } else if (msg.text === "/digest") {
          await handleDigest();
        } else if (msg.text === "/attention") {
          await handleAttention();
        } else if (
          msg.text === "/knowledge" ||
          msg.text.startsWith("/knowledge ")
        ) {
          await handleKnowledge(msg.text);
        } else if (
          msg.text === "/memory" ||
          msg.text.startsWith("/memory ")
        ) {
          await handleMemory(msg.text);
        } else if (
          msg.text === "/history" ||
          msg.text.startsWith("/history ")
        ) {
          await handleHistory(msg.text);
        } else if (
          msg.text === "/tasks" ||
          msg.text.startsWith("/tasks ")
        ) {
          await handleTasks(msg.text);
        } else if (
          msg.text === "/recall" ||
          msg.text.startsWith("/recall ")
        ) {
          await handleRecall(msg.text);
        } else if (
          msg.text === "/answer-log" ||
          msg.text.startsWith("/answer-log ")
        ) {
          await handleAnswerLog(msg.text);
        } else if (
          msg.text === "/answer-show" ||
          msg.text.startsWith("/answer-show ")
        ) {
          await handleAnswerShow(msg.text);
        } else if (
          msg.text === "/answer" ||
          msg.text.startsWith("/answer ")
        ) {
          await handleAnswer(msg.text);
        }
      }
    } catch (err) {
      if (!running) return;
      log?.(`Telegram status poll error: ${(err as Error).message}`);
      await sleep(ERROR_BACKOFF_MS);
    }

    if (running) {
      timer = setTimeout(() => void poll(), POLL_INTERVAL_MS);
    }
  }

  void poll();

  return () => {
    running = false;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
