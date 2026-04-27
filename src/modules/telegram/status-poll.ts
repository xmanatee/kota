import { join } from "node:path";
import type {
  HistoryClient,
  KnowledgeClient,
  MemoryClient,
  RecallClient,
  RepoTasksClient,
} from "#core/server/kota-client.js";
import type { WorkflowRuntimeState } from "#core/workflow/run-types.js";
import { computeCostByWorkflow, loadRecentRuns } from "#modules/autonomy/shared.js";
import { renderOnDemandAttention } from "#modules/autonomy/workflows/attention-digest/step.js";
import { renderOnDemandDigest } from "#modules/autonomy/workflows/daily-digest/on-demand.js";
import { renderHistorySearchPlain } from "#modules/history/render.js";
import { renderKnowledgeSearchPlain } from "#modules/knowledge/render.js";
import { renderMemorySearchPlain } from "#modules/memory/render.js";
import { renderRecallHitsPlain } from "#modules/recall/render.js";
import { renderRepoTaskSearchPlain } from "#modules/repo-tasks/render.js";
import { callTelegramApi } from "./client.js";

const POLL_INTERVAL_MS = 30_000;
const ERROR_BACKOFF_MS = 5_000;
/** Telegram sendMessage hard limit; longer bodies must be truncated client-side. */
const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;

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
