/**
 * Telegram module — makes KOTA accessible via Telegram messaging.
 *
 * Contributes interactive and status channels hosted inside the daemon, and
 * configured notification forwarding for workflow events.
 */

import type { ChannelDef } from "#core/channels/channel.js";
import { resolveChannelAutonomyMode } from "#core/config/autonomy-mode-resolver.js";
import { DAEMON_PROJECT_SCOPE_PROVIDER_TYPE } from "#core/daemon/project-scope-provider.js";
import type { BusEvents } from "#core/events/event-bus.js";
import type { KotaModule, ModuleContext } from "#core/modules/module-types.js";
import type { KotaClient } from "#core/server/kota-client.js";
import { AUTONOMY_MODES, type AutonomyMode } from "#core/tools/autonomy-mode.js";
import { TelegramBot } from "./bot.js";
import { startCallbackPoll } from "./callback-poll.js";
import type { TelegramMessage } from "./client.js";
import { callTelegramApi } from "./client.js";
import {
  type PendingMessage,
  tryHandleOwnerQuestionReply,
} from "./owner-question-reply.js";
import {
  type TelegramChatProjectBinding,
  TelegramProjectSelection,
} from "./project-selection.js";
import { startTelegramStatusPoll } from "./status-poll.js";

async function sendTelegramMessage(
  token: string,
  chatId: string,
  text: string,
  log: ModuleContext["log"],
): Promise<void> {
  void callTelegramApi(token, "sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "Markdown",
  }).catch((err: unknown) => {
    log.warn(`Failed to send Telegram message: ${(err as Error).message}`);
  });
}

function eventProjectId(payload: object): string | undefined {
  return "projectId" in payload && typeof payload.projectId === "string"
    ? payload.projectId
    : undefined;
}

async function sendTelegramProjectMessage(
  token: string,
  chatId: string,
  text: string,
  projectId: string | undefined,
  projectSelection: TelegramProjectSelection | undefined,
  log: ModuleContext["log"],
): Promise<void> {
  const prefix = await renderProjectLabelPrefix(projectId, projectSelection, log);
  await sendTelegramMessage(token, chatId, `${prefix}${text}`, log);
}

async function renderProjectLabelPrefix(
  projectId: string | undefined,
  projectSelection: TelegramProjectSelection | undefined,
  log: ModuleContext["log"],
): Promise<string> {
  if (!projectId || !projectSelection) return "";
  try {
    return await projectSelection.renderProjectLabelPrefix(projectId);
  } catch (err) {
    log.warn(`Telegram project label unavailable: ${(err as Error).message}`);
    return "";
  }
}

type InlineButton = { text: string; callback_data: string };

function buildOwnerQuestionKeyboard(
  id: string,
  proposedAnswers: string[],
): InlineButton[][] {
  const rows: InlineButton[][] = [];
  for (let i = 0; i < proposedAnswers.length; i += 2) {
    const row: InlineButton[] = [
      { text: proposedAnswers[i], callback_data: `answer:${id}:${i}` },
    ];
    if (i + 1 < proposedAnswers.length) {
      row.push({
        text: proposedAnswers[i + 1],
        callback_data: `answer:${id}:${i + 1}`,
      });
    }
    rows.push(row);
  }
  rows.push([{ text: "Dismiss", callback_data: `dismiss:${id}` }]);
  return rows;
}

type OwnerQuestionAskedPayload = BusEvents["owner.question.asked"];

function ownerQuestionBehaviorText(value: OwnerQuestionAskedPayload["answerBehavior"] | undefined): string {
  if (value === "workflow-resume") {
    return "Answer resumes the waiting workflow.";
  }
  if (value === "record-only") {
    return "Answer is recorded only; no suspended workflow resumes.";
  }
  return "Answer behavior not recorded.";
}

function compactOwnerQuestionContext(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value.trim() === "") return null;
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > 240 ? `${compact.slice(0, 237)}...` : compact;
}

function ownerQuestionOriginLines(origin: OwnerQuestionAskedPayload["origin"] | undefined): string[] {
  if (!origin) return ["Origin: not recorded"];
  if (origin.kind === "workflow") {
    return [
      `Workflow: ${origin.workflowName}`,
      `Run: \`${origin.runId}\``,
      `Task: ${origin.taskId ?? "not recorded"}`,
    ];
  }
  if (origin.kind === "session") {
    return [`Session: \`${origin.sessionId ?? "not recorded"}\``];
  }
  return [`Origin: ${origin.source}`];
}

async function sendOwnerQuestionMessage(
  token: string,
  chatId: string,
  id: string,
  question: string,
  reason: string,
  source: string,
  context: string | null,
  answerBehavior: OwnerQuestionAskedPayload["answerBehavior"] | undefined,
  origin: OwnerQuestionAskedPayload["origin"] | undefined,
  proposedAnswers: string[],
  projectLabelPrefix: string,
  log: ModuleContext["log"],
): Promise<number | null> {
  const text = [
    `${projectLabelPrefix}Owner question from *${source}*`,
    ...ownerQuestionOriginLines(origin),
    `Behavior: ${ownerQuestionBehaviorText(answerBehavior)}`,
    `Reason: ${reason}`,
    `Question: ${question}`,
    context ? `Context: ${context}` : null,
    `ID: \`${id}\``,
    ``,
    `kota owner-question show ${id}`,
    `kota owner-question answer ${id} <your answer>`,
    `kota owner-question dismiss ${id}`,
  ].filter((line): line is string => line !== null).join("\n");
  try {
    const msg = await callTelegramApi<TelegramMessage>(token, "sendMessage", {
      chat_id: chatId,
      text,
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: buildOwnerQuestionKeyboard(id, proposedAnswers),
      },
    });
    return msg.message_id;
  } catch (err) {
    log.warn(`Failed to send Telegram owner-question message: ${(err as Error).message}`);
    return null;
  }
}

async function sendApprovalMessage(
  token: string,
  chatId: string,
  approvalId: string,
  tool: string,
  risk: string,
  reason: string,
  projectLabelPrefix: string,
  log: ModuleContext["log"],
): Promise<number | null> {
  const text = [
    `${projectLabelPrefix}Approval required: *${tool}*`,
    `Risk: ${risk}`,
    `Reason: ${reason}`,
    `ID: \`${approvalId}\``,
    ``,
    `kota approval approve ${approvalId}`,
    `kota approval reject ${approvalId}`,
  ].join("\n");
  try {
    const msg = await callTelegramApi<TelegramMessage>(token, "sendMessage", {
      chat_id: chatId,
      text,
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "✅ Approve", callback_data: `approve:${approvalId}` },
            { text: "❌ Reject", callback_data: `reject:${approvalId}` },
          ],
        ],
      },
    });
    return msg.message_id;
  } catch (err) {
    log.warn(`Failed to send Telegram approval message: ${(err as Error).message}`);
    return null;
  }
}

type TelegramConfig = {
  /** Subset of opt-in notification events to forward. Default: none. */
  events?: string[];
  /** Autonomy mode applied to Telegram chat sessions. */
  defaultAutonomyMode?: AutonomyMode;
  /** Whitelist of chat IDs allowed to open interactive sessions. Empty/undefined = allow all. */
  allowedChatIds?: number[];
  /** Default Telegram chat -> project bindings used when the daemon hosts multiple projects. */
  chatProjectBindings?: TelegramChatProjectBinding[];
};

function getCredentials(): { token: string; chatId: string } | null {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_ALERT_CHAT_ID;
  if (!token || !chatId) return null;
  return { token, chatId };
}

type TelegramProjectRouting = {
  client: KotaClient;
  selection: TelegramProjectSelection;
};

type TelegramProjectSource = Pick<KotaClient["projects"], "list">;

function hasProjectRoutingClient(client: KotaClient): boolean {
  return typeof client.forProject === "function" &&
    typeof client.projects?.list === "function";
}

// Channels are contributed before the daemon publishes a daemon-control client.
// Once the daemon is constructing the channel, its in-process registry provider
// is the authoritative project-list source.
function resolveDaemonProjectSource(
  ctx: ModuleContext,
): TelegramProjectSource | undefined {
  const projectScope = ctx.getProvider(DAEMON_PROJECT_SCOPE_PROVIDER_TYPE);
  if (!projectScope) return undefined;
  return {
    list: async () => {
      const projection = projectScope.getProjectRegistryProjection();
      return {
        ok: true as const,
        projects: projection.projects,
        defaultProjectId: projection.defaultProjectId,
        activeProjectId: projectScope.getActiveProjectId(),
      };
    },
  };
}

function resolveTelegramProjectRouting(
  ctx: ModuleContext,
  chatProjectBindings: TelegramChatProjectBinding[],
): TelegramProjectRouting | undefined {
  let client: KotaClient;
  try {
    client = ctx.client;
  } catch {
    return undefined;
  }
  if (!hasProjectRoutingClient(client)) return undefined;
  const projectSource = resolveDaemonProjectSource(ctx);
  return {
    client,
    selection: new TelegramProjectSelection(
      client,
      ctx.storage,
      chatProjectBindings,
      projectSource ? { projectSource } : undefined,
    ),
  };
}

function makeTelegramStatusChannel(
  moduleCtx: ModuleContext,
  chatProjectBindings: TelegramChatProjectBinding[],
): ChannelDef {
  return {
    name: "telegram-status",
    description:
      "Responds to /status, /digest, /attention, /knowledge, /memory, /history, /tasks, /recall, /answer, /answer-log, /answer-show, /capture, /capture-to-memory, /capture-to-knowledge, /capture-to-tasks, /capture-to-inbox, /retract, /retract-memory, /retract-knowledge, /retract-tasks, and /retract-inbox in Telegram",
    create(ctx) {
      const token = process.env.TELEGRAM_BOT_TOKEN;
      const chatId = process.env.TELEGRAM_ALERT_CHAT_ID;
      if (!token || !chatId) {
        return {
          status: "unavailable",
          reason:
            "TELEGRAM_BOT_TOKEN and TELEGRAM_ALERT_CHAT_ID env vars are required",
        };
      }
      const projectRouting = resolveTelegramProjectRouting(
        moduleCtx,
        chatProjectBindings,
      );

      let stop: (() => void) | null = null;
      return {
        status: "started",
        adapter: {
          async start() {
            stop = startTelegramStatusPoll(
              token,
              chatId,
              ctx.projectDir,
              ctx.getWorkflowStatus,
              moduleCtx.client.knowledge,
              moduleCtx.client.memory,
              moduleCtx.client.history,
              moduleCtx.client.tasks,
              moduleCtx.client.recall,
              moduleCtx.client.answer,
              moduleCtx.client.capture,
              moduleCtx.client.retract,
              ctx.log,
              projectRouting,
            );
          },
          stop() {
            stop?.();
          },
        },
      };
    },
  };
}

function makeTelegramInteractiveChannel(
  ctx: ModuleContext,
  chatProjectBindings: TelegramChatProjectBinding[],
): ChannelDef {
  return {
    name: "telegram-interactive",
    description: "Hosts the interactive Telegram bot as a daemon channel (one session per chat)",
    create(channelCtx) {
      const token = process.env.TELEGRAM_BOT_TOKEN;
      if (!token) {
        return {
          status: "unavailable",
          reason: "TELEGRAM_BOT_TOKEN env var is required",
        };
      }

      const telegramConfig = ctx.getModuleConfig<TelegramConfig>();
      const autonomyMode = resolveChannelAutonomyMode(
        telegramConfig?.defaultAutonomyMode,
        ctx.config,
        "telegram",
      );

      const allowedChatIds = telegramConfig?.allowedChatIds;
      const projectRouting = resolveTelegramProjectRouting(
        ctx,
        chatProjectBindings,
      );
      const bot = new TelegramBot({
        token,
        model: ctx.config.model,
        verbose: ctx.verbose || ctx.config.verbose,
        config: ctx.config,
        autonomyMode,
        defaultProjectRuntime: channelCtx.defaultProjectRuntime,
        getProjectRuntime: channelCtx.getProjectRuntime,
        allowedChatIds,
        projectSelection: projectRouting?.selection,
        onChatReply: (chatId, replyToMessageId, text) =>
          tryHandleOwnerQuestionReply({
            token,
            chatId,
            replyToMessageId,
            text,
            pending: pendingOwnerQuestionMessages,
            allowedChatIds,
            log: ctx.log,
            client: ctx.client,
          }),
      });

      const unsubscribeSchedule = ctx.events.subscribe("schedule.fire", (payload) => {
        const description = typeof payload.description === "string"
          ? payload.description
          : JSON.stringify(payload);
        const projectId = typeof payload.projectId === "string" ? payload.projectId : undefined;
        void (async () => {
          const prefix = await renderProjectLabelPrefix(
            projectId,
            projectRouting?.selection,
            ctx.log,
          );
          bot.broadcastToChats(`${prefix}⏰ Reminder: ${description}`, projectId);
        })();
      });

      let startPromise: Promise<void> | null = null;
      return {
        status: "started",
        adapter: {
          async start() {
            startPromise = bot.start().catch((err) => {
              ctx.log.error(
                `telegram-interactive channel poll loop exited: ${(err as Error).message}`,
              );
            });
          },
          async stop() {
            unsubscribeSchedule();
            bot.stop();
            if (startPromise) {
              await startPromise;
              startPromise = null;
            }
          },
        },
      };
    },
  };
}

let notificationUnsubs: (() => void)[] = [];
let stopCallbackPoll: (() => void) | null = null;
const pendingApprovalMessages = new Map<string, PendingMessage>();
const pendingOwnerQuestionMessages = new Map<string, PendingMessage>();

const telegramModule: KotaModule = {
  name: "telegram",
  version: "1.0.0",
  description: "Telegram bot frontend for KOTA",
  dependencies: ["answer", "approval-queue", "autonomy", "capture", "daemon-ops", "history", "knowledge", "memory", "recall", "repo-tasks", "retract", "transcription"],
  configSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      events: {
        type: "array",
        items: { type: "string", minLength: 1 },
        uniqueItems: true,
      },
      defaultAutonomyMode: { type: "string", enum: AUTONOMY_MODES },
      allowedChatIds: {
        type: "array",
        items: { type: "integer" },
        uniqueItems: true,
      },
      chatProjectBindings: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["chatId", "projectId"],
          properties: {
            chatId: { type: "integer" },
            projectId: { type: "string", minLength: 1 },
          },
        },
      },
    },
  },

  channels: (ctx) => {
    const telegramConfig = ctx.getModuleConfig<TelegramConfig>();
    const chatProjectBindings = telegramConfig?.chatProjectBindings ?? [];
    return [
      makeTelegramStatusChannel(ctx, chatProjectBindings),
      makeTelegramInteractiveChannel(ctx, chatProjectBindings),
    ];
  },

  onLoad: (ctx) => {
    const telegramConfig = ctx.getModuleConfig<TelegramConfig>();
    const chatProjectBindings = telegramConfig?.chatProjectBindings ?? [];
    const optInEvents = new Set(telegramConfig?.events ?? []);

    const creds = getCredentials();
    if (creds) {
      stopCallbackPoll = startCallbackPoll(
        creds.token,
        pendingApprovalMessages,
        pendingOwnerQuestionMessages,
        ctx.log,
        ctx.client,
      );
    }

    notificationUnsubs = [
      ctx.events.subscribe("workflow.failure.alert", (payload) => {
        const creds = getCredentials();
        if (!creds) return;
        void sendTelegramProjectMessage(
          creds.token,
          creds.chatId,
          payload.text as string,
          eventProjectId(payload),
          resolveTelegramProjectRouting(ctx, chatProjectBindings)?.selection,
          ctx.log,
        );
      }),
      ctx.events.subscribe("workflow.attention.digest", (payload) => {
        const creds = getCredentials();
        if (!creds) return;
        void sendTelegramProjectMessage(
          creds.token,
          creds.chatId,
          payload.text as string,
          eventProjectId(payload),
          resolveTelegramProjectRouting(ctx, chatProjectBindings)?.selection,
          ctx.log,
        );
      }),
      ctx.events.subscribe("workflow.daily.digest", (payload) => {
        const creds = getCredentials();
        if (!creds) return;
        void sendTelegramProjectMessage(
          creds.token,
          creds.chatId,
          payload.text as string,
          eventProjectId(payload),
          resolveTelegramProjectRouting(ctx, chatProjectBindings)?.selection,
          ctx.log,
        );
      }),
      ctx.events.subscribe("workflow.approval.expired", (payload) => {
        const creds = getCredentials();
        if (!creds) return;
        void sendTelegramProjectMessage(
          creds.token,
          creds.chatId,
          payload.text as string,
          eventProjectId(payload),
          resolveTelegramProjectRouting(ctx, chatProjectBindings)?.selection,
          ctx.log,
        );
      }),
      ctx.events.subscribe("module.crash.alert", (payload) => {
        const creds = getCredentials();
        if (!creds) return;
        void sendTelegramMessage(creds.token, creds.chatId, payload.text as string, ctx.log);
      }),
      ctx.events.subscribe("approval.requested", (payload) => {
        const creds = getCredentials();
        if (!creds) return;
        const id = payload.id as string;
        const tool = payload.tool as string;
        const risk = payload.risk as string;
        const reason = payload.reason as string;
        const projectId = payload.projectId as string;
        void (async () => sendApprovalMessage(
          creds.token,
          creds.chatId,
          id,
          tool,
          risk,
          reason,
          await renderProjectLabelPrefix(
            projectId,
            resolveTelegramProjectRouting(ctx, chatProjectBindings)?.selection,
            ctx.log,
          ),
          ctx.log,
        ))().then(
          (messageId) => {
            if (messageId != null) {
              pendingApprovalMessages.set(id, { chatId: creds.chatId, messageId, projectId });
            }
          },
        );
      }),
      ctx.events.subscribe("owner.question.asked", (payload) => {
        const creds = getCredentials();
        if (!creds) return;
        const id = payload.id as string;
        const question = payload.question as string;
        const reason = payload.reason as string;
        const source = payload.source as string;
        const projectId = payload.projectId as string;
        const payloadProposedAnswers = Array.isArray(payload.proposedAnswers)
          ? payload.proposedAnswers.filter((answer): answer is string => typeof answer === "string")
          : [];
        void (async () => {
          const projectRouting = resolveTelegramProjectRouting(ctx, chatProjectBindings);
          const listed = projectRouting
            ? await projectRouting.client.forProject(projectId).ownerQuestions.list()
            : { questions: [] };
          const entry = listed.questions.find((question) => question.id === id);
          const proposedAnswers = payloadProposedAnswers.length > 0
            ? payloadProposedAnswers
            : entry?.proposedAnswers ?? [];
          const messageId = await sendOwnerQuestionMessage(
            creds.token,
            creds.chatId,
            id,
            question,
            reason,
            source,
            compactOwnerQuestionContext(payload.context ?? entry?.context),
            payload.answerBehavior ?? entry?.answerBehavior,
            payload.origin ?? entry?.origin,
            proposedAnswers,
            await renderProjectLabelPrefix(projectId, projectRouting?.selection, ctx.log),
            ctx.log,
          );
          if (messageId != null) {
            pendingOwnerQuestionMessages.set(id, {
              chatId: creds.chatId,
              messageId,
              projectId,
              proposedAnswers,
            });
          }
        })();
      }),
      ...(optInEvents.has("workflow.build.committed")
        ? [
            ctx.events.subscribe("workflow.build.committed", (payload) => {
              const creds = getCredentials();
              if (!creds) return;
              const commitMessage = payload.commitMessage as string;
              const taskId = payload.taskId as string | null;
              const costUsd = payload.costUsd as number | null;
              const durationMs = payload.durationMs as number | null;
              const costPart = costUsd != null ? `$${costUsd.toFixed(2)}` : null;
              const durationPart =
                durationMs != null ? `${Math.round(durationMs / 60000)}m` : null;
              const meta = [taskId, costPart, durationPart].filter(Boolean).join(" · ");
              const text = [`✅ Builder committed: ${commitMessage}`, meta ? `Task: ${meta}` : null]
                .filter(Boolean)
                .join("\n");
              void sendTelegramProjectMessage(
                creds.token,
                creds.chatId,
                text,
                eventProjectId(payload),
                resolveTelegramProjectRouting(ctx, chatProjectBindings)?.selection,
                ctx.log,
              );
            }),
          ]
        : []),
    ];
  },

  onUnload: () => {
    stopCallbackPoll?.();
    stopCallbackPoll = null;
    pendingApprovalMessages.clear();
    pendingOwnerQuestionMessages.clear();
    for (const unsub of notificationUnsubs) unsub();
    notificationUnsubs = [];
  },
};

export default telegramModule;
