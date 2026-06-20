import type { AnswerClient } from "#modules/answer/client.js";
import type { CaptureClient } from "#modules/capture/client.js";
import type { HistoryClient } from "#modules/history/client.js";
import type { KnowledgeClient } from "#modules/knowledge/client.js";
import type { MemoryClient } from "#modules/memory/client.js";
import type { RecallClient } from "#modules/recall/client.js";
import type { RepoTasksClient } from "#modules/repo-tasks/client.js";
import type { RetractClient } from "#modules/retract/client.js";
import { callTelegramApi } from "./client.js";
import { acquireTelegramPollingOwner } from "./polling-ownership.js";
import {
  handleResolvedTelegramStatusCommand,
  handleTelegramProjectCommand,
  isTelegramProjectCommand,
  isTelegramStatusCommand,
} from "./status-commands.js";

export { handleTelegramStatusCommand } from "./status-commands.js";
export { buildStatusText } from "./status-render.js";

import { resolveTelegramStatusScope } from "./status-scope.js";
import type {
  StatusInfo,
  TelegramStatusPollProjectRouting,
  TelegramStatusScope,
} from "./status-types.js";

export type {
  StatusInfo,
  TelegramStatusCommandOptions,
  TelegramStatusPollProjectRouting,
  TelegramStatusScope,
} from "./status-types.js";

const POLL_INTERVAL_MS = 30_000;
const ERROR_BACKOFF_MS = 5_000;

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
  capture: CaptureClient,
  retract: RetractClient,
  log?: (message: string) => void,
  projectRouting?: TelegramStatusPollProjectRouting,
): () => void {
  const releasePollingOwner = acquireTelegramPollingOwner(token, {
    owner: "telegram-status",
    source: "legacy status poll helper",
  });
  let running = true;
  let offset = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const defaultScope: TelegramStatusScope = {
    projectDir,
    getStatusInfo,
    knowledge,
    memory,
    history,
    tasks,
    recall,
    answer,
    capture,
    retract,
  };

  async function sendPlain(text: string): Promise<void> {
    await callTelegramApi(token, "sendMessage", {
      chat_id: chatId,
      text,
    });
  }

  async function sendMarkdown(text: string): Promise<void> {
    await callTelegramApi(token, "sendMessage", {
      chat_id: chatId,
      text,
      parse_mode: "Markdown",
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

        if (isTelegramProjectCommand(msg.text)) {
          await handleTelegramProjectCommand({
            text: msg.text,
            messageChatId: msg.chat.id,
            projectRouting,
            sendPlain,
          });
          continue;
        }

        const resolvedScope = await resolveTelegramStatusScope(
          msg.chat.id,
          defaultScope,
          projectRouting,
        );
        if (!resolvedScope.ok) {
          await sendPlain(resolvedScope.message);
          continue;
        }

        if (!isTelegramStatusCommand(msg.text)) continue;

        await handleResolvedTelegramStatusCommand({
          text: msg.text,
          scope: resolvedScope.scope,
          sendPlain,
          sendMarkdown,
        });
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
    releasePollingOwner();
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
