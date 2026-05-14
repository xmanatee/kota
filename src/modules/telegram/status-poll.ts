import { join } from "node:path";
import type { KotaClient } from "#core/server/kota-client.js";
import type { WorkflowRuntimeState } from "#core/workflow/run-types.js";
import type { AnswerClient } from "#modules/answer/client.js";
import {
  renderAnswerHistoryEntriesPlain,
  renderAnswerReplyPlain,
} from "#modules/answer/render.js";
import { computeCostByWorkflow, loadRecentRuns } from "#modules/autonomy/shared.js";
import { renderOnDemandAttention } from "#modules/autonomy/workflows/attention-digest/step.js";
import { renderOnDemandDigest } from "#modules/autonomy/workflows/daily-digest/on-demand.js";
import { CAPTURE_TARGET_ORDER } from "#modules/capture/capture-types.js";
import type {
  CaptureClient,
  CaptureFilter,
  CaptureTarget,
} from "#modules/capture/client.js";
import { renderCaptureReplyPlain } from "#modules/capture/render.js";
import type { HistoryClient } from "#modules/history/client.js";
import { renderHistorySearchPlain } from "#modules/history/render.js";
import type { KnowledgeClient } from "#modules/knowledge/client.js";
import { renderKnowledgeSearchPlain } from "#modules/knowledge/render.js";
import type { MemoryClient } from "#modules/memory/client.js";
import { renderMemorySearchPlain } from "#modules/memory/render.js";
import type { RecallClient } from "#modules/recall/client.js";
import { renderRecallHitsPlain } from "#modules/recall/render.js";
import type { RepoTasksClient } from "#modules/repo-tasks/client.js";
import { renderRepoTaskSearchPlain } from "#modules/repo-tasks/render.js";
import type { RetractClient } from "#modules/retract/client.js";
import {
  type RetractSlashCommand,
  renderRetractResultPlain,
  retractUsageBody,
} from "#modules/retract/render.js";
import { callTelegramApi, splitMessage } from "./client.js";
import type { TelegramProjectSelection } from "./project-selection.js";

const POLL_INTERVAL_MS = 30_000;
const ERROR_BACKOFF_MS = 5_000;
/** Telegram sendMessage hard limit; longer bodies must be truncated client-side. */
const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;
/** Default page size for the chat-side `/answer-log` projection. */
const ANSWER_LOG_DEFAULT_LIMIT = 5;

/**
 * Fixed help body for the umbrella `/retract` command. The retract seam
 * intentionally has no classifier, so the umbrella exists only to point
 * the operator at the four explicit-target subcommands.
 */
const RETRACT_UMBRELLA_HELP_BODY =
  "Retract removes one record from one named store. The seam has no classifier — pick the target explicitly:\n" +
  "  /retract-memory <id>\n" +
  "  /retract-knowledge <slug>\n" +
  "  /retract-tasks <id>\n" +
  "  /retract-inbox <path>";

export type StatusInfo = {
  runtimeState: WorkflowRuntimeState;
  dispatchPaused: boolean;
  runsDir: string;
};

export type TelegramStatusPollProjectRouting = {
  client: KotaClient;
  selection: TelegramProjectSelection;
};

type TelegramStatusScope = {
  projectDir: string;
  getStatusInfo: () => StatusInfo | Promise<StatusInfo>;
  knowledge: KnowledgeClient;
  memory: MemoryClient;
  history: HistoryClient;
  tasks: RepoTasksClient;
  recall: RecallClient;
  answer: AnswerClient;
  capture: CaptureClient;
  retract: RetractClient;
};

type TelegramStatusScopeResolution =
  | { ok: true; scope: TelegramStatusScope }
  | { ok: false; message: string };

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
  answer: AnswerClient,
  capture: CaptureClient,
  retract: RetractClient,
  log?: (message: string) => void,
  projectRouting?: TelegramStatusPollProjectRouting,
): () => void {
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

  async function resolveScope(chatId: number): Promise<TelegramStatusScopeResolution> {
    if (!projectRouting) return { ok: true, scope: defaultScope };
    const resolved = await projectRouting.selection.resolveChat(chatId);
    if (!resolved.ok) return resolved;
    const scoped = projectRouting.client.forProject(resolved.project.projectId);
    return {
      ok: true,
      scope: {
        projectDir: resolved.project.projectDir,
        getStatusInfo: async () => {
          const status = await scoped.workflow.status();
          return {
            runtimeState: {
              activeRuns: status.activeRuns,
              completedRuns: status.completedRuns,
              pendingRuns: status.pendingRuns,
              workflows: status.workflows,
            },
            dispatchPaused: status.paused,
            runsDir: join(resolved.project.projectDir, ".kota", "runs"),
          };
        },
        knowledge: scoped.knowledge,
        memory: scoped.memory,
        history: scoped.history,
        tasks: scoped.tasks,
        recall: scoped.recall,
        answer: scoped.answer,
        capture: scoped.capture,
        retract: scoped.retract,
      },
    };
  }

  async function sendPlain(text: string): Promise<void> {
    await callTelegramApi(token, "sendMessage", {
      chat_id: chatId,
      text,
    });
  }

  async function handleProjectCommand(chatId: number, text: string): Promise<void> {
    if (!projectRouting) return;
    const requested = text === "/project" ? "" : text.slice("/project ".length);
    const result = await projectRouting.selection.switchChat(chatId, requested);
    await sendPlain(result.message);
  }

  async function handleStatus(scope: TelegramStatusScope): Promise<void> {
    const text = buildStatusText(await scope.getStatusInfo());
    await callTelegramApi(token, "sendMessage", {
      chat_id: chatId,
      text,
      parse_mode: "Markdown",
    });
  }

  async function handleDigest(scope: TelegramStatusScope): Promise<void> {
    const { text } = renderOnDemandDigest({ projectDir: scope.projectDir });
    await callTelegramApi(token, "sendMessage", {
      chat_id: chatId,
      // Plain text — the rendered digest contains underscores, parentheses,
      // and backticks that would require Markdown escaping.
      text: truncateForTelegram(text),
    });
  }

  async function handleAttention(scope: TelegramStatusScope): Promise<void> {
    const runsDir = join(scope.projectDir, ".kota", "runs");
    const { text } = renderOnDemandAttention({ projectDir: scope.projectDir, runsDir });
    await callTelegramApi(token, "sendMessage", {
      chat_id: chatId,
      // Plain text — the rendered attention body uses bullet glyphs and
      // *bold* markers that would require Markdown escaping.
      text: truncateForTelegram(text),
    });
  }

  async function handleKnowledge(scope: TelegramStatusScope, text: string): Promise<void> {
    const query =
      text === "/knowledge" ? "" : text.slice("/knowledge ".length).trim();
    if (query.length === 0) {
      await callTelegramApi(token, "sendMessage", {
        chat_id: chatId,
        text: "Usage: /knowledge <query>",
      });
      return;
    }
    const result = await scope.knowledge.search(query, { semantic: true, limit: 10 });
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

  async function handleMemory(scope: TelegramStatusScope, text: string): Promise<void> {
    const query =
      text === "/memory" ? "" : text.slice("/memory ".length).trim();
    if (query.length === 0) {
      await callTelegramApi(token, "sendMessage", {
        chat_id: chatId,
        text: "Usage: /memory <query>",
      });
      return;
    }
    const result = await scope.memory.search(query, { semantic: true, limit: 10 });
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

  async function handleHistory(scope: TelegramStatusScope, text: string): Promise<void> {
    const query =
      text === "/history" ? "" : text.slice("/history ".length).trim();
    if (query.length === 0) {
      await callTelegramApi(token, "sendMessage", {
        chat_id: chatId,
        text: "Usage: /history <query>",
      });
      return;
    }
    const result = await scope.history.search(query, { semantic: true, limit: 10 });
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

  async function handleRecall(scope: TelegramStatusScope, text: string): Promise<void> {
    const query =
      text === "/recall" ? "" : text.slice("/recall ".length).trim();
    if (query.length === 0) {
      await callTelegramApi(token, "sendMessage", {
        chat_id: chatId,
        text: "Usage: /recall <query>",
      });
      return;
    }
    const result = await scope.recall.recall(query);
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

  async function handleAnswer(scope: TelegramStatusScope, text: string): Promise<void> {
    const query =
      text === "/answer" ? "" : text.slice("/answer ".length).trim();
    if (query.length === 0) {
      await callTelegramApi(token, "sendMessage", {
        chat_id: chatId,
        text: "Usage: /answer <query>",
      });
      return;
    }
    const result = await scope.answer.answer(query);
    await callTelegramApi(token, "sendMessage", {
      chat_id: chatId,
      // Plain text — the synthesized prose can carry Markdown-active
      // characters and bracketed `[source:id]` markers that would require
      // escaping if Markdown parse_mode were enabled.
      text: truncateForTelegram(renderAnswerReplyPlain(result)),
    });
  }

  async function handleAnswerLog(scope: TelegramStatusScope, text: string): Promise<void> {
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
    const result = await scope.answer.log({ limit });
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

  async function handleAnswerShow(scope: TelegramStatusScope, text: string): Promise<void> {
    const id =
      text === "/answer-show" ? "" : text.slice("/answer-show ".length).trim();
    if (id.length === 0) {
      await callTelegramApi(token, "sendMessage", {
        chat_id: chatId,
        text: "Usage: /answer-show <id>",
      });
      return;
    }
    const result = await scope.answer.show(id);
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

  /**
   * One shared handler for `/capture` plus the four explicit
   * `/capture-to-<target>` twins. The classifier path corresponds to
   * `target === undefined`; the explicit-target twins pass a literal
   * `CaptureTarget`. Empty / whitespace-only bodies short-circuit to
   * the seam's `ambiguous` envelope rendering rather than calling the
   * seam — matching the seam's own empty-text contract while avoiding
   * a wasted classifier call.
   */
  async function handleCapture(
    scope: TelegramStatusScope,
    body: string,
    target: CaptureTarget | undefined,
  ): Promise<void> {
    const trimmed = body.trim();
    if (trimmed.length === 0) {
      await callTelegramApi(token, "sendMessage", {
        chat_id: chatId,
        text: renderCaptureReplyPlain({
          ok: false,
          reason: "ambiguous",
          suggestions: CAPTURE_TARGET_ORDER,
        }),
      });
      return;
    }
    const filter: CaptureFilter | undefined =
      target === undefined ? undefined : { target };
    const result = await scope.capture.capture(trimmed, filter);
    await callTelegramApi(token, "sendMessage", {
      chat_id: chatId,
      // Plain text — captured identifiers, slugs, and contributor error
      // messages can carry Markdown-active characters that would require
      // escaping if Markdown parse_mode were enabled.
      text: truncateForTelegram(renderCaptureReplyPlain(result)),
    });
  }

  function captureCommandBody(text: string, command: string): string {
    if (text === command) return "";
    if (text.startsWith(`${command} `)) return text.slice(command.length + 1);
    return text;
  }

  /**
   * One shared handler for the four `/retract-<target>` commands. The
   * Telegram layer resolves the target from the command name and the
   * per-target identifier from the slash-command argument before calling
   * the seam. The retract seam has no classifier; there is no unguided
   * `/retract <text>` primary, so an empty / whitespace-only argument
   * short-circuits to a fixed usage body before the seam is called.
   */
  async function handleRetract(
    scope: TelegramStatusScope,
    command: RetractSlashCommand,
    body: string,
  ): Promise<void> {
    const trimmed = body.trim();
    if (trimmed.length === 0) {
      await callTelegramApi(token, "sendMessage", {
        chat_id: chatId,
        text: retractUsageBody(command),
      });
      return;
    }
    const result = await (() => {
      switch (command) {
        case "/retract-memory":
          return scope.retract.retract({ target: "memory", id: trimmed });
        case "/retract-knowledge":
          return scope.retract.retract({ target: "knowledge", slug: trimmed });
        case "/retract-tasks":
          return scope.retract.retract({ target: "tasks", id: trimmed });
        case "/retract-inbox":
          return scope.retract.retract({ target: "inbox", path: trimmed });
      }
    })();
    await callTelegramApi(token, "sendMessage", {
      chat_id: chatId,
      // Plain text — typed identifiers, slugs, paths, and contributor
      // error messages can carry Markdown-active characters that would
      // require escaping if Markdown parse_mode were enabled.
      text: truncateForTelegram(renderRetractResultPlain(result)),
    });
  }

  async function handleRetractHelp(): Promise<void> {
    await callTelegramApi(token, "sendMessage", {
      chat_id: chatId,
      text: RETRACT_UMBRELLA_HELP_BODY,
    });
  }

  async function handleTasks(scope: TelegramStatusScope, text: string): Promise<void> {
    const query =
      text === "/tasks" ? "" : text.slice("/tasks ".length).trim();
    if (query.length === 0) {
      await callTelegramApi(token, "sendMessage", {
        chat_id: chatId,
        text: "Usage: /tasks <query>",
      });
      return;
    }
    const result = await scope.tasks.search(query, { semantic: true, limit: 10 });
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

        if (msg.text === "/project" || msg.text.startsWith("/project ")) {
          await handleProjectCommand(msg.chat.id, msg.text);
          continue;
        }
        const resolvedScope = await resolveScope(msg.chat.id);
        if (!resolvedScope.ok) {
          await sendPlain(resolvedScope.message);
          continue;
        }
        const { scope } = resolvedScope;

        if (msg.text === "/status") {
          await handleStatus(scope);
        } else if (msg.text === "/digest") {
          await handleDigest(scope);
        } else if (msg.text === "/attention") {
          await handleAttention(scope);
        } else if (
          msg.text === "/knowledge" ||
          msg.text.startsWith("/knowledge ")
        ) {
          await handleKnowledge(scope, msg.text);
        } else if (
          msg.text === "/memory" ||
          msg.text.startsWith("/memory ")
        ) {
          await handleMemory(scope, msg.text);
        } else if (
          msg.text === "/history" ||
          msg.text.startsWith("/history ")
        ) {
          await handleHistory(scope, msg.text);
        } else if (
          msg.text === "/tasks" ||
          msg.text.startsWith("/tasks ")
        ) {
          await handleTasks(scope, msg.text);
        } else if (
          msg.text === "/recall" ||
          msg.text.startsWith("/recall ")
        ) {
          await handleRecall(scope, msg.text);
        } else if (
          msg.text === "/answer-log" ||
          msg.text.startsWith("/answer-log ")
        ) {
          await handleAnswerLog(scope, msg.text);
        } else if (
          msg.text === "/answer-show" ||
          msg.text.startsWith("/answer-show ")
        ) {
          await handleAnswerShow(scope, msg.text);
        } else if (
          msg.text === "/answer" ||
          msg.text.startsWith("/answer ")
        ) {
          await handleAnswer(scope, msg.text);
        } else if (
          msg.text === "/capture-to-memory" ||
          msg.text.startsWith("/capture-to-memory ")
        ) {
          await handleCapture(
            scope,
            captureCommandBody(msg.text, "/capture-to-memory"),
            "memory",
          );
        } else if (
          msg.text === "/capture-to-knowledge" ||
          msg.text.startsWith("/capture-to-knowledge ")
        ) {
          await handleCapture(
            scope,
            captureCommandBody(msg.text, "/capture-to-knowledge"),
            "knowledge",
          );
        } else if (
          msg.text === "/capture-to-tasks" ||
          msg.text.startsWith("/capture-to-tasks ")
        ) {
          await handleCapture(
            scope,
            captureCommandBody(msg.text, "/capture-to-tasks"),
            "tasks",
          );
        } else if (
          msg.text === "/capture-to-inbox" ||
          msg.text.startsWith("/capture-to-inbox ")
        ) {
          await handleCapture(
            scope,
            captureCommandBody(msg.text, "/capture-to-inbox"),
            "inbox",
          );
        } else if (
          msg.text === "/capture" ||
          msg.text.startsWith("/capture ")
        ) {
          await handleCapture(
            scope,
            captureCommandBody(msg.text, "/capture"),
            undefined,
          );
        } else if (
          msg.text === "/retract-memory" ||
          msg.text.startsWith("/retract-memory ")
        ) {
          await handleRetract(
            scope,
            "/retract-memory",
            captureCommandBody(msg.text, "/retract-memory"),
          );
        } else if (
          msg.text === "/retract-knowledge" ||
          msg.text.startsWith("/retract-knowledge ")
        ) {
          await handleRetract(
            scope,
            "/retract-knowledge",
            captureCommandBody(msg.text, "/retract-knowledge"),
          );
        } else if (
          msg.text === "/retract-tasks" ||
          msg.text.startsWith("/retract-tasks ")
        ) {
          await handleRetract(
            scope,
            "/retract-tasks",
            captureCommandBody(msg.text, "/retract-tasks"),
          );
        } else if (
          msg.text === "/retract-inbox" ||
          msg.text.startsWith("/retract-inbox ")
        ) {
          await handleRetract(
            scope,
            "/retract-inbox",
            captureCommandBody(msg.text, "/retract-inbox"),
          );
        } else if (
          msg.text === "/retract" ||
          msg.text.startsWith("/retract ")
        ) {
          await handleRetractHelp();
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
