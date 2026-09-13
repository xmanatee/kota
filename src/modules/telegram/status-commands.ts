import { join } from "node:path";
import {
  answerCommandReply,
  answerLogCommandReply,
  answerShowCommandReply,
} from "#modules/answer/commands.js";
import { renderOnDemandAttention } from "#modules/autonomy/workflows/attention-digest/step.js";
import { renderOnDemandDigest } from "#modules/autonomy/workflows/daily-digest/on-demand.js";
import type { CaptureTarget } from "#modules/capture/client.js";
import { captureCommandReply } from "#modules/capture/commands.js";
import { historyCommandReply } from "#modules/history/commands.js";
import { knowledgeCommandReply } from "#modules/knowledge/commands.js";
import { memoryCommandReply } from "#modules/memory/commands.js";
import { recallCommandReply } from "#modules/recall/commands.js";
import { tasksCommandReply } from "#modules/repo-tasks/commands.js";
import type { RetractTarget } from "#modules/retract/client.js";
import { retractCommandReply } from "#modules/retract/commands.js";
import { callTelegramApi, splitMessage } from "./client.js";
import {
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
    const status = await scope.getStatusInfo();
    const { text: body } = renderOnDemandAttention({
      scopeRoot: scope.scopeRoot,
      runsDir: status.runsDir,
      authority: status.runAuthority,
    });
    await sendPlain(truncateForTelegram(body));
    return true;
  }
  if (commandMatches(text, "/knowledge")) {
    await sendPlain(
      truncateForTelegram(await knowledgeCommandReply(scope.knowledge, commandBody(text, "/knowledge"))),
    );
    return true;
  }
  if (commandMatches(text, "/memory")) {
    await sendPlain(
      truncateForTelegram(await memoryCommandReply(scope.memory, commandBody(text, "/memory"))),
    );
    return true;
  }
  if (commandMatches(text, "/history")) {
    await sendPlain(
      truncateForTelegram(await historyCommandReply(scope.history, commandBody(text, "/history"))),
    );
    return true;
  }
  if (commandMatches(text, "/tasks")) {
    await sendPlain(
      truncateForTelegram(await tasksCommandReply(scope.tasks, commandBody(text, "/tasks"))),
    );
    return true;
  }
  if (commandMatches(text, "/recall")) {
    await sendPlain(
      truncateForTelegram(await recallCommandReply(scope.recall, commandBody(text, "/recall"))),
    );
    return true;
  }
  if (commandMatches(text, "/answer-log")) {
    const arg = text === "/answer-log" ? "" : text.slice("/answer-log ".length).trim();
    await sendPlain(truncateForTelegram(await answerLogCommandReply(scope.answer, arg)));
    return true;
  }
  if (commandMatches(text, "/answer-show")) {
    const id = text === "/answer-show" ? "" : text.slice("/answer-show ".length).trim();
    for (const chunk of splitMessage(await answerShowCommandReply(scope.answer, id))) {
      await sendPlain(chunk);
    }
    return true;
  }
  if (commandMatches(text, "/answer")) {
    const query = text === "/answer" ? "" : text.slice("/answer ".length).trim();
    await sendPlain(truncateForTelegram(await answerCommandReply(scope.answer, query)));
    return true;
  }

  async function handleCaptureCommand(
    command: string,
    target: CaptureTarget | undefined,
  ): Promise<void> {
    const body = commandBody(text, command).trim();
    await sendPlain(
      truncateForTelegram(await captureCommandReply(scope.capture, body, target)),
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

  async function handleRetractCommand(target: RetractTarget): Promise<void> {
    const body = commandBody(text, `/retract-${target}`).trim();
    await sendPlain(truncateForTelegram(await retractCommandReply(scope.retract, target, body)));
  }

  if (commandMatches(text, "/retract-memory")) {
    await handleRetractCommand("memory");
    return true;
  }
  if (commandMatches(text, "/retract-knowledge")) {
    await handleRetractCommand("knowledge");
    return true;
  }
  if (commandMatches(text, "/retract-tasks")) {
    await handleRetractCommand("tasks");
    return true;
  }
  if (commandMatches(text, "/retract-inbox")) {
    await handleRetractCommand("inbox");
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
