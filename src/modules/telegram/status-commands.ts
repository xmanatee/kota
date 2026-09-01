import { join } from "node:path";
import {
  renderAnswerHistoryEntriesPlain,
  renderAnswerReplyPlain,
} from "#modules/answer/render.js";
import { renderOnDemandAttention } from "#modules/autonomy/workflows/attention-digest/step.js";
import { renderOnDemandDigest } from "#modules/autonomy/workflows/daily-digest/on-demand.js";
import { CAPTURE_TARGET_ORDER } from "#modules/capture/capture-types.js";
import type { CaptureFilter, CaptureTarget } from "#modules/capture/client.js";
import { renderCaptureReplyPlain } from "#modules/capture/render.js";
import { renderHistorySearchPlain } from "#modules/history/render.js";
import { renderKnowledgeSearchPlain } from "#modules/knowledge/render.js";
import { renderMemorySearchPlain } from "#modules/memory/render.js";
import { renderRecallHitsPlain } from "#modules/recall/render.js";
import { renderRepoTaskSearchPlain } from "#modules/repo-tasks/render.js";
import {
  type RetractSlashCommand,
  renderRetractResultPlain,
  retractUsageBody,
} from "#modules/retract/render.js";
import { callTelegramApi, splitMessage } from "./client.js";
import {
  ANSWER_LOG_DEFAULT_LIMIT,
  buildStatusText,
  RETRACT_UMBRELLA_HELP_BODY,
  truncateForTelegram,
} from "./status-render.js";
import { resolveTelegramStatusScope } from "./status-scope.js";
import type {
  TelegramStatusCommandOptions,
  TelegramStatusPollScopeRouting,
  TelegramStatusScope,
  TelegramStatusSenders,
} from "./status-types.js";

const STATUS_COMMANDS = [
  "/status",
  "/digest",
  "/attention",
  "/knowledge",
  "/memory",
  "/history",
  "/tasks",
  "/recall",
  "/answer-log",
  "/answer-show",
  "/answer",
  "/capture-to-memory",
  "/capture-to-knowledge",
  "/capture-to-tasks",
  "/capture-to-inbox",
  "/capture",
  "/retract-memory",
  "/retract-knowledge",
  "/retract-tasks",
  "/retract-inbox",
  "/retract",
] as const;

function commandMatches(text: string, command: string): boolean {
  return text === command || text.startsWith(`${command} `);
}

export function isTelegramScopeCommand(text: string): boolean {
  return commandMatches(text, "/scope");
}

export function isTelegramStatusCommand(text: string): boolean {
  return STATUS_COMMANDS.some((command) => commandMatches(text, command));
}

export async function handleTelegramScopeCommand(options: {
  text: string;
  messageChatId: number;
  scopeRouting?: TelegramStatusPollScopeRouting;
  sendPlain: (body: string) => Promise<void>;
}): Promise<boolean> {
  const { text, messageChatId, scopeRouting, sendPlain } = options;
  if (!isTelegramScopeCommand(text)) return false;
  if (!scopeRouting) return false;
  const requested = text === "/scope" ? "" : text.slice("/scope ".length);
  const result = await scopeRouting.selection.switchChat(messageChatId, requested);
  await sendPlain(result.message);
  return true;
}

export async function handleTelegramStatusCommand(
  options: TelegramStatusCommandOptions,
): Promise<boolean> {
  const { token, messageChatId, text, defaultScope, scopeRouting } = options;

  const sendPlain = async (body: string): Promise<void> => {
    await callTelegramApi(token, "sendMessage", {
      chat_id: messageChatId,
      text: body,
    });
  };

  const sendMarkdown = async (body: string): Promise<void> => {
    await callTelegramApi(token, "sendMessage", {
      chat_id: messageChatId,
      text: body,
      parse_mode: "Markdown",
    });
  };

  if (isTelegramScopeCommand(text)) {
    return handleTelegramScopeCommand({
      text,
      messageChatId,
      scopeRouting,
      sendPlain,
    });
  }

  if (!isTelegramStatusCommand(text)) return false;

  const resolvedScope = await resolveTelegramStatusScope(
    messageChatId,
    defaultScope,
    scopeRouting,
  );
  if (!resolvedScope.ok) {
    await sendPlain(resolvedScope.message);
    return true;
  }

  return handleResolvedTelegramStatusCommand({
    text,
    scope: resolvedScope.scope,
    sendPlain,
    sendMarkdown,
  });
}

export async function handleResolvedTelegramStatusCommand(
  options: TelegramStatusSenders & {
    text: string;
    scope: TelegramStatusScope;
  },
): Promise<boolean> {
  const { text, scope, sendPlain, sendMarkdown } = options;

  if (text === "/status") {
    await sendMarkdown(buildStatusText(await scope.getStatusInfo()));
    return true;
  }
  if (text === "/digest") {
    const { text: body } = renderOnDemandDigest({
      scopeRoot: scope.scopeRoot,
      stateDir: join(scope.scopeRoot, ".kota"),
    });
    await sendPlain(truncateForTelegram(body));
    return true;
  }
  if (text === "/attention") {
    const runsDir = join(scope.scopeRoot, ".kota", "runs");
    const { text: body } = renderOnDemandAttention({
      scopeRoot: scope.scopeRoot,
      runsDir,
    });
    await sendPlain(truncateForTelegram(body));
    return true;
  }
  if (commandMatches(text, "/knowledge")) {
    const query = text === "/knowledge" ? "" : text.slice("/knowledge ".length).trim();
    if (!query) {
      await sendPlain("Usage: /knowledge <query>");
      return true;
    }
    const result = await scope.knowledge.search(query, { semantic: true, limit: 10 });
    if (!result.ok) {
      await sendPlain("Semantic knowledge search requires an embedding-backed knowledge provider.");
      return true;
    }
    await sendPlain(
      result.entries.length === 0
        ? "No matching knowledge entries."
        : truncateForTelegram(renderKnowledgeSearchPlain(result.entries)),
    );
    return true;
  }
  if (commandMatches(text, "/memory")) {
    const query = text === "/memory" ? "" : text.slice("/memory ".length).trim();
    if (!query) {
      await sendPlain("Usage: /memory <query>");
      return true;
    }
    const result = await scope.memory.search(query, { semantic: true, limit: 10 });
    if (!result.ok) {
      await sendPlain("Semantic memory search requires an embedding-backed memory provider.");
      return true;
    }
    await sendPlain(
      result.entries.length === 0
        ? "No matching memory entries."
        : truncateForTelegram(renderMemorySearchPlain(result.entries)),
    );
    return true;
  }
  if (commandMatches(text, "/history")) {
    const query = text === "/history" ? "" : text.slice("/history ".length).trim();
    if (!query) {
      await sendPlain("Usage: /history <query>");
      return true;
    }
    const result = await scope.history.search(query, { semantic: true, limit: 10 });
    if (!result.ok) {
      await sendPlain("Semantic conversation search requires an embedding-backed history provider.");
      return true;
    }
    await sendPlain(
      result.conversations.length === 0
        ? "No matching conversations."
        : truncateForTelegram(renderHistorySearchPlain(result.conversations)),
    );
    return true;
  }
  if (commandMatches(text, "/tasks")) {
    const query = text === "/tasks" ? "" : text.slice("/tasks ".length).trim();
    if (!query) {
      await sendPlain("Usage: /tasks <query>");
      return true;
    }
    const result = await scope.tasks.search(query, { semantic: true, limit: 10 });
    if (!result.ok) {
      await sendPlain("Semantic task search requires an embedding-backed repo-tasks provider.");
      return true;
    }
    await sendPlain(
      result.tasks.length === 0
        ? "No matching tasks."
        : truncateForTelegram(renderRepoTaskSearchPlain(result.tasks)),
    );
    return true;
  }
  if (commandMatches(text, "/recall")) {
    const query = text === "/recall" ? "" : text.slice("/recall ".length).trim();
    if (!query) {
      await sendPlain("Usage: /recall <query>");
      return true;
    }
    const result = await scope.recall.recall(query);
    if (!result.ok) {
      await sendPlain("Cross-store recall is not configured: no contributors are registered.");
      return true;
    }
    await sendPlain(
      result.hits.length === 0
        ? "No matching items."
        : truncateForTelegram(renderRecallHitsPlain(result.hits)),
    );
    return true;
  }
  if (commandMatches(text, "/answer-log")) {
    const arg = text === "/answer-log" ? "" : text.slice("/answer-log ".length).trim();
    let limit = ANSWER_LOG_DEFAULT_LIMIT;
    if (arg.length > 0) {
      const parsed = Number.parseInt(arg, 10);
      if (!Number.isFinite(parsed) || parsed <= 0 || String(parsed) !== arg) {
        await sendPlain("Usage: /answer-log [N]");
        return true;
      }
      limit = parsed;
    }
    const result = await scope.answer.log({ limit });
    await sendPlain(
      result.entries.length === 0
        ? "No past answer records yet."
        : truncateForTelegram(renderAnswerHistoryEntriesPlain(result.entries)),
    );
    return true;
  }
  if (commandMatches(text, "/answer-show")) {
    const id = text === "/answer-show" ? "" : text.slice("/answer-show ".length).trim();
    if (!id) {
      await sendPlain("Usage: /answer-show <id>");
      return true;
    }
    const result = await scope.answer.show(id);
    if (!result.ok) {
      await sendPlain(`No answer record found for id "${id}".`);
      return true;
    }
    for (const chunk of splitMessage(renderAnswerReplyPlain(result.record.result))) {
      await sendPlain(chunk);
    }
    return true;
  }
  if (commandMatches(text, "/answer")) {
    const query = text === "/answer" ? "" : text.slice("/answer ".length).trim();
    if (!query) {
      await sendPlain("Usage: /answer <query>");
      return true;
    }
    await sendPlain(truncateForTelegram(renderAnswerReplyPlain(await scope.answer.answer(query))));
    return true;
  }

  async function handleCaptureCommand(
    command: string,
    target: CaptureTarget | undefined,
  ): Promise<void> {
    const body = commandBody(text, command).trim();
    if (!body) {
      await sendPlain(
        renderCaptureReplyPlain({
          ok: false,
          reason: "ambiguous",
          suggestions: CAPTURE_TARGET_ORDER,
        }),
      );
      return;
    }
    const filter: CaptureFilter | undefined = target === undefined ? undefined : { target };
    await sendPlain(
      truncateForTelegram(renderCaptureReplyPlain(await scope.capture.capture(body, filter))),
    );
  }

  if (commandMatches(text, "/capture-to-memory")) {
    await handleCaptureCommand("/capture-to-memory", "memory");
    return true;
  }
  if (commandMatches(text, "/capture-to-knowledge")) {
    await handleCaptureCommand("/capture-to-knowledge", "knowledge");
    return true;
  }
  if (commandMatches(text, "/capture-to-tasks")) {
    await handleCaptureCommand("/capture-to-tasks", "tasks");
    return true;
  }
  if (commandMatches(text, "/capture-to-inbox")) {
    await handleCaptureCommand("/capture-to-inbox", "inbox");
    return true;
  }
  if (commandMatches(text, "/capture")) {
    await handleCaptureCommand("/capture", undefined);
    return true;
  }

  async function handleRetractCommand(command: RetractSlashCommand): Promise<void> {
    const body = commandBody(text, command).trim();
    if (!body) {
      await sendPlain(retractUsageBody(command));
      return;
    }
    const result = await scope.retract.retract({
      target: command.slice("/retract-".length) as "memory" | "knowledge" | "tasks" | "inbox",
      identifier: body,
    });
    await sendPlain(truncateForTelegram(renderRetractResultPlain(result)));
  }

  if (commandMatches(text, "/retract-memory")) {
    await handleRetractCommand("/retract-memory");
    return true;
  }
  if (commandMatches(text, "/retract-knowledge")) {
    await handleRetractCommand("/retract-knowledge");
    return true;
  }
  if (commandMatches(text, "/retract-tasks")) {
    await handleRetractCommand("/retract-tasks");
    return true;
  }
  if (commandMatches(text, "/retract-inbox")) {
    await handleRetractCommand("/retract-inbox");
    return true;
  }
  if (commandMatches(text, "/retract")) {
    await sendPlain(RETRACT_UMBRELLA_HELP_BODY);
    return true;
  }

  return false;
}

function commandBody(text: string, command: string): string {
  if (text === command) return "";
  if (text.startsWith(`${command} `)) return text.slice(command.length + 1);
  return text;
}
