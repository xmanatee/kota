/**
 * Telegram module — makes KOTA accessible via Telegram messaging.
 *
 * Contributes interactive and status channels hosted inside the daemon, and
 * configured notification forwarding for workflow events.
 */

import { resolveAgentHarness } from "#core/agent-harness/index.js";
import type { ChannelDef } from "#core/channels/channel.js";
import { resolveChannelAutonomyMode } from "#core/config/autonomy-mode-resolver.js";
import type { ApprovalClientProjection } from "#core/daemon/approval-queue.js";
import {
  CAPABILITY_READINESS_PROVIDER_TYPE,
  type CapabilityReadiness,
  type CapabilityReadinessSource,
} from "#core/daemon/capability-readiness.js";
import { DAEMON_PROJECT_SCOPE_PROVIDER_TYPE } from "#core/daemon/project-scope-provider.js";
import type { BusEvents } from "#core/events/event-bus.js";
import { checkPresetAuth } from "#core/model/preset.js";
import type { KotaModule, ModuleContext } from "#core/modules/module-types.js";
import type { ModuleSetupRequirement } from "#core/modules/setup-requirements.js";
import type { KotaClient } from "#core/server/kota-client.js";
import { AUTONOMY_MODES, type AutonomyMode } from "#core/tools/autonomy-mode.js";
import { operatorSurfaceEffect } from "#core/tools/effect.js";
import {
  autonomyHealthSignal,
  normalizeHealthSignal,
} from "#modules/autonomy/health-signal.js";
import {
  apiKeyNameForProvider,
  resolveApiKey,
  resolveModelProviderName,
} from "#modules/model-clients/factory.js";
import {
  buildApprovalCallbackData,
  pendingApprovalMessageKey,
} from "./approval-callback.js";
import {
  isModelClientHarness,
  resolveTelegramInteractiveBackend,
} from "./backend.js";
import { TelegramBot, TelegramGetUpdatesConflictError } from "./bot.js";
import {
  createTelegramCallbackHandler,
  type PendingApprovalMessage,
} from "./callback-poll.js";
import type { TelegramMessage } from "./client.js";
import { callTelegramApi } from "./client.js";
import type { TelegramInboundSignalConfig } from "./inbound-signal.js";
import {
  type PendingMessage,
  tryHandleOwnerQuestionReply,
} from "./owner-question-reply.js";
import {
  type TelegramChatProjectBinding,
  TelegramProjectSelection,
} from "./project-selection.js";
import {
  buildStatusText,
  handleTelegramStatusCommand,
  type TelegramStatusScope,
} from "./status-poll.js";

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
  approval: ApprovalClientProjection,
  projectLabelPrefix: string,
  log: ModuleContext["log"],
): Promise<{ messageId: number; reviewDigest: string } | null> {
  if (approval.review.status !== "available") {
    await callTelegramApi<TelegramMessage>(token, "sendMessage", {
      chat_id: chatId,
      text: [
        `${projectLabelPrefix}Approval required: ${approval.tool}`,
        `Risk: ${approval.risk}`,
        `Reason: ${approval.reason}`,
        "Input unavailable after daemon restart. Reject and retry the tool call.",
      ].join("\n"),
    }).catch((err) => {
      log.warn(`Failed to send Telegram approval message: ${(err as Error).message}`);
    });
    return null;
  }
  const text = [
    `${projectLabelPrefix}Approval required: ${approval.tool}`,
    `Risk: ${approval.risk}`,
    `Reason: ${approval.reason}`,
    `Reviewed input: ${JSON.stringify(approval.review.input)}`,
    ...(approval.review.context !== undefined
      ? [`Conversation context: ${approval.review.context}`]
      : []),
    `Review digest: ${approval.review.digest}`,
    `ID: ${approval.id}`,
    ``,
    `kota approval approve ${approval.id}`,
    `kota approval reject ${approval.id}`,
  ].join("\n");
  try {
    const msg = await callTelegramApi<TelegramMessage>(token, "sendMessage", {
      chat_id: chatId,
      text,
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "✅ Approve",
              callback_data: buildApprovalCallbackData("approve", approval.review.digest),
            },
            {
              text: "❌ Reject",
              callback_data: buildApprovalCallbackData("reject", approval.review.digest),
            },
          ],
        ],
      },
    });
    return { messageId: msg.message_id, reviewDigest: approval.review.digest };
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
  /** Prefix-configured text updates that emit inbound.signal.received. */
  inboundSignals?: TelegramInboundSignalConfig;
};

export const TELEGRAM_INTERACTIVE_BACKEND_CAPABILITY_ID =
  "telegram.interactive.backend";

const telegramSetupRequirements: ModuleSetupRequirement[] = [
  {
    id: "bot-credentials",
    kind: "secret",
    title: "Telegram bot credentials",
    description:
      "Bot token and default alert chat reference used by Telegram channels.",
    required: true,
    scope: "project",
    owner: "telegram",
    sensitivity: "secret",
    setup: {
      mode: "url",
      url: "https://t.me/BotFather",
      label: "Open BotFather",
      pendingTtlMs: 30 * 60 * 1000,
    },
    secretRefs: [
      { name: "TELEGRAM_BOT_TOKEN", scope: "project" },
      { name: "TELEGRAM_ALERT_CHAT_ID", scope: "project" },
    ],
  },
  {
    id: "interactive-model-backend",
    kind: "capability",
    title: "Telegram interactive model backend",
    description:
      "Model or harness backend used by Telegram chat sessions after bot credentials are present.",
    required: true,
    scope: "project",
    owner: "telegram",
    sensitivity: "none",
    setup: { mode: "none" },
    capabilityIds: [TELEGRAM_INTERACTIVE_BACKEND_CAPABILITY_ID],
  },
];

const reportedTelegramPollConflicts = new Set<string>();

function getCredentials(ctx: ModuleContext): { token: string; chatId: string } | null {
  const token = ctx.getSecret("TELEGRAM_BOT_TOKEN");
  const chatId = ctx.getSecret("TELEGRAM_ALERT_CHAT_ID");
  if (!token || !chatId) return null;
  return { token, chatId };
}

function telegramInteractiveProviderError(
  ctx: ModuleContext,
  model: string,
  explicitProvider?: {
    provider?: string;
    apiKey?: string;
  },
): string | null {
  const provider = resolveModelProviderName(model, explicitProvider?.provider);
  if (!provider) {
    return `Telegram interactive sessions require a model provider for "${model}". Set config.modelProvider.type, use provider/model notation, or select a multi-turn harness preset that does not require ModelClient.`;
  }
  const apiKeyEnv = apiKeyNameForProvider(provider);
  if (apiKeyEnv && !resolveApiKey(provider, explicitProvider?.apiKey, { projectDir: ctx.cwd })) {
    return `Telegram interactive sessions require ${apiKeyEnv} or config.modelProvider.apiKey for provider "${provider}".`;
  }
  return null;
}

function telegramInteractiveBackendReadiness(
  ctx: ModuleContext,
): CapabilityReadiness {
  const telegramConfig = ctx.getModuleConfig<TelegramConfig>();
  let autonomyMode: AutonomyMode;
  try {
    autonomyMode = resolveChannelAutonomyMode(
      telegramConfig?.defaultAutonomyMode,
      ctx.config,
      "telegram",
    );
  } catch (err) {
    return {
      id: TELEGRAM_INTERACTIVE_BACKEND_CAPABILITY_ID,
      moduleName: "telegram",
      status: "unavailable",
      reason: "autonomy_mode_missing",
      message: (err as Error).message,
    };
  }

  const backendError = telegramInteractiveBackendError(ctx, autonomyMode);
  if (backendError) {
    return {
      id: TELEGRAM_INTERACTIVE_BACKEND_CAPABILITY_ID,
      moduleName: "telegram",
      status: "unavailable",
      reason: "interactive_backend_unavailable",
      message: backendError,
    };
  }

  const backend = resolveTelegramInteractiveBackend(ctx.config);
  if (backend.kind === "harness") {
    return {
      id: TELEGRAM_INTERACTIVE_BACKEND_CAPABILITY_ID,
      moduleName: "telegram",
      status: "ready",
      reason: "harness_ready",
      message: `Telegram interactive chat is ready through the "${backend.harnessName}" harness.`,
      meta: {
        backend: "harness",
        harness: backend.harnessName,
        model: backend.model,
      },
    };
  }

  return {
    id: TELEGRAM_INTERACTIVE_BACKEND_CAPABILITY_ID,
    moduleName: "telegram",
    status: "ready",
    reason: "model_client_ready",
    message: "Telegram interactive chat is ready through the configured ModelClient provider.",
    meta: {
      backend: "model-client",
      model: backend.modelSpec,
    },
  };
}

function createTelegramReadinessSource(ctx: ModuleContext): CapabilityReadinessSource {
  return {
    moduleName: "telegram",
    probe: () => [telegramInteractiveBackendReadiness(ctx)],
  };
}

function emitTelegramPollConflictHealthSignal(
  ctx: ModuleContext,
  projectId: string,
): void {
  const dedupeKey = "module:telegram:getupdates-conflict";
  const reportKey = `${projectId}:${dedupeKey}`;
  if (reportedTelegramPollConflicts.has(reportKey)) return;
  reportedTelegramPollConflicts.add(reportKey);

  const signal = normalizeHealthSignal({
    source: { kind: "module", id: "telegram-interactive", module: "telegram" },
    severity: "warning",
    labels: ["external-service", "polling", "telegram"],
    summary:
      "Telegram Bot API reported a getUpdates conflict for telegram-interactive. Another process or poller is using the same bot token; stop the duplicate consumer before enabling Telegram chat.",
    evidenceRefs: [
      {
        kind: "module-log",
        ref: "telegram-interactive:getUpdates",
        summary:
          "Bot API getUpdates returned a conflict while the interactive Telegram channel was running.",
      },
    ],
    actionability: "external-service",
    dedupeKey,
    observationCount: 1,
    createdAt: new Date().toISOString(),
  });

  try {
    ctx.events.emit(autonomyHealthSignal, {
      scopeId: projectId,
      projectId,
      ...signal,
    });
  } catch (err) {
    ctx.log.warn(
      `Telegram getUpdates conflict health signal failed: ${(err as Error).message}`,
    );
  }
}

function telegramInteractiveBackendError(
  ctx: ModuleContext,
  autonomyMode: AutonomyMode,
): string | null {
  const backend = resolveTelegramInteractiveBackend(ctx.config);
  if (backend.kind === "model-client") {
    return telegramInteractiveProviderError(
      ctx,
      backend.modelSpec,
      backend.modelProvider,
    );
  }

  let harness: ReturnType<typeof resolveAgentHarness>;
  try {
    harness = resolveAgentHarness(backend.harnessName);
  } catch (err) {
    return (err as Error).message;
  }

  if (!harness.supportsMultiTurn) {
    return `Telegram interactive sessions require a multi-turn agent harness; "${harness.name}" does not support multi-turn conversation.`;
  }

  if (autonomyMode === "supervised") {
    const unsupported = harness.unsupportedRunOptions?.find(
      (entry) => entry.runOption === "autonomyMode.supervised",
    );
    if (unsupported) {
      return `Telegram interactive sessions cannot use autonomyMode "supervised" with harness "${harness.name}": ${unsupported.reason}`;
    }
  }

  if (backend.usesPresetHarness) {
    const auth = checkPresetAuth(backend.preset);
    if (auth.missing.length > 0) {
      return `Telegram interactive sessions require ${auth.missing.join(" or ")} for preset "${backend.preset.id}".`;
    }
  }

  if (isModelClientHarness(backend.harnessName)) {
    return telegramInteractiveProviderError(
      ctx,
      backend.model,
      backend.modelProvider,
    );
  }

  return null;
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
  const client = tryResolveTelegramClient(ctx);
  if (!client) return undefined;
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

function tryResolveTelegramClient(ctx: ModuleContext): KotaClient | undefined {
  try {
    return ctx.client;
  } catch {
    return undefined;
  }
}

function makeTelegramStatusChannel(
  moduleCtx: ModuleContext,
): ChannelDef {
  return {
    name: "telegram-status",
    description:
      "Declares Telegram status-command readiness; the interactive channel owns the single Bot API update stream.",
    create() {
      const credentials = getCredentials(moduleCtx);
      if (!credentials) {
        return {
          status: "unavailable",
          reason:
            "TELEGRAM_BOT_TOKEN and TELEGRAM_ALERT_CHAT_ID secret refs are required",
        };
      }
      const client = tryResolveTelegramClient(moduleCtx);
      if (!client) {
        return {
          status: "unavailable",
          reason: "KotaClient is not resolved; Telegram status commands require a daemon or local client",
        };
      }
      return {
        status: "started",
        adapter: {
          async start() {},
          stop() {},
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
      const credentials = getCredentials(ctx);
      if (!credentials) {
        return {
          status: "unavailable",
          reason: "TELEGRAM_BOT_TOKEN and TELEGRAM_ALERT_CHAT_ID secret refs are required",
        };
      }
      const { token } = credentials;

      const telegramConfig = ctx.getModuleConfig<TelegramConfig>();
      const autonomyMode = resolveChannelAutonomyMode(
        telegramConfig?.defaultAutonomyMode,
        ctx.config,
        "telegram",
      );
      const backendError = telegramInteractiveBackendError(ctx, autonomyMode);
      if (backendError) {
        return {
          status: "unavailable",
          reason: backendError,
        };
      }

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
        pollOwner: {
          owner: "telegram-interactive",
          source: "daemon channel",
        },
        defaultProjectRuntime: channelCtx.defaultProjectRuntime,
        getProjectRuntime: channelCtx.getProjectRuntime,
        allowedChatIds,
        projectSelection: projectRouting?.selection,
        inboundSignals: telegramConfig?.inboundSignals
          ? {
              config: telegramConfig.inboundSignals,
              events: ctx.events,
            }
          : undefined,
        onChatReply: (chatId, replyToMessageId, text) =>
          tryHandleOwnerQuestionReply({
            token,
            chatId,
            replyToMessageId,
            text,
            pending: pendingOwnerQuestionMessages,
            allowedChatIds,
            log: ctx.log,
            client: tryResolveTelegramClient(ctx),
          }),
        onCallbackQuery: createTelegramCallbackHandler(
          token,
          pendingApprovalMessages,
          pendingOwnerQuestionMessages,
          tryResolveTelegramClient(ctx),
          ctx.log,
        ),
        onStatusCommand: async (chatId, text) => {
          if (String(chatId) !== credentials.chatId) return false;
          const client = tryResolveTelegramClient(ctx);
          if (!client) {
            if (text !== "/status") return false;
            await callTelegramApi(token, "sendMessage", {
              chat_id: chatId,
              text: buildStatusText(channelCtx.getWorkflowStatus()),
              parse_mode: "Markdown",
            });
            return true;
          }
          const defaultScope: TelegramStatusScope = {
            projectDir: channelCtx.projectDir,
            getStatusInfo: channelCtx.getWorkflowStatus,
            knowledge: client.knowledge,
            memory: client.memory,
            history: client.history,
            tasks: client.tasks,
            recall: client.recall,
            answer: client.answer,
            capture: client.capture,
            retract: client.retract,
          };
          return handleTelegramStatusCommand({
            token,
            messageChatId: chatId,
            text,
            defaultScope,
            projectRouting,
          });
        },
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
              const message = (err as Error).message;
              if (err instanceof TelegramGetUpdatesConflictError) {
                emitTelegramPollConflictHealthSignal(
                  ctx,
                  channelCtx.defaultProjectRuntime.project.projectId,
                );
              }
              ctx.log.error(`telegram-interactive channel poll loop exited: ${message}`);
              channelCtx.reportFailure(message);
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
const pendingApprovalMessages = new Map<string, PendingApprovalMessage>();
const pendingOwnerQuestionMessages = new Map<string, PendingMessage>();

const telegramModule: KotaModule = {
  name: "telegram",
  version: "1.0.0",
  description: "Telegram bot frontend for KOTA",
  dependencies: ["answer", "approval-queue", "autonomy", "capture", "daemon-ops", "history", "inbound-signals", "knowledge", "memory", "model-clients", "recall", "repo-tasks", "retract", "secrets", "transcription"],
  setupRequirements: telegramSetupRequirements,
  manifest: {
    schemaVersion: 1,
    capabilities: [
      {
        id: "telegram.status",
        description:
          "Serve operator status, recall, answer, capture, retract, digest, and attention commands in Telegram.",
        scope: "external",
        scopePolicyHooks: ["channels", "external-effects", "setup"],
        setupRequirementIds: ["bot-credentials"],
      },
      {
        id: "telegram.interactive",
        description: "Route Telegram chats into KOTA sessions with explicit autonomy mode.",
        scope: "external",
        scopePolicyHooks: ["channels", "external-effects", "setup"],
        setupRequirementIds: ["bot-credentials", "interactive-model-backend"],
      },
      {
        id: "telegram.owner-escalation",
        description:
          "Deliver owner questions, approvals, failure alerts, and digest notifications to Telegram.",
        scope: "external",
        scopePolicyHooks: ["owner-confirmation", "external-effects", "setup"],
        setupRequirementIds: ["bot-credentials"],
      },
    ],
    dataClasses: [
      {
        id: "telegram.bot-credentials",
        description: "Telegram bot token and alert chat id secret references.",
        sensitivity: "credential",
        retention: "project-durable",
        redaction: "mask-secret",
      },
      {
        id: "telegram.message-content",
        description: "Telegram command text, chat replies, inbound signal text, and rendered responses.",
        sensitivity: "personal",
        retention: "run-artifact",
        redaction: "metadata-only",
      },
      {
        id: "telegram.owner-escalation-content",
        description: "Owner question, approval, failure alert, and digest message metadata.",
        sensitivity: "internal",
        retention: "operator-visible",
        redaction: "metadata-only",
      },
    ],
    additionalEffects: [
      {
        id: "telegram.message-delivery",
        description: "Deliver operator commands, approvals, owner questions, and notifications to Telegram.",
        source: "channel",
        effect: operatorSurfaceEffect(),
        capabilityIds: [
          "telegram.status",
          "telegram.interactive",
          "telegram.owner-escalation",
        ],
      },
    ],
    simulation: {
      support: "external-effects-blocked",
      blockedReasons: [
        "Telegram delivery is operator-visible external I/O and is blocked in workflow trial mode.",
      ],
    },
  },
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
      inboundSignals: {
        type: "object",
        additionalProperties: false,
        required: ["prefixes"],
        properties: {
          prefixes: {
            type: "array",
            minItems: 1,
            uniqueItems: true,
            items: { type: "string", minLength: 1 },
          },
          trustedChatIds: {
            type: "array",
            uniqueItems: true,
            items: { type: "integer" },
          },
          blockedChatIds: {
            type: "array",
            uniqueItems: true,
            items: { type: "integer" },
          },
        },
      },
    },
  },

  channels: (ctx) => {
    const telegramConfig = ctx.getModuleConfig<TelegramConfig>();
    const chatProjectBindings = telegramConfig?.chatProjectBindings ?? [];
    return [
      makeTelegramStatusChannel(ctx),
      makeTelegramInteractiveChannel(ctx, chatProjectBindings),
    ];
  },

  onLoad: (ctx) => {
    ctx.registerProvider(
      CAPABILITY_READINESS_PROVIDER_TYPE,
      createTelegramReadinessSource(ctx),
    );
    const telegramConfig = ctx.getModuleConfig<TelegramConfig>();
    const chatProjectBindings = telegramConfig?.chatProjectBindings ?? [];
    const optInEvents = new Set(telegramConfig?.events ?? []);

    notificationUnsubs = [
      ctx.events.subscribe("workflow.failure.alert", (payload) => {
        const creds = getCredentials(ctx);
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
        const creds = getCredentials(ctx);
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
        const creds = getCredentials(ctx);
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
        const creds = getCredentials(ctx);
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
        const creds = getCredentials(ctx);
        if (!creds) return;
        void sendTelegramMessage(creds.token, creds.chatId, payload.text as string, ctx.log);
      }),
      ctx.events.subscribe("approval.requested", (payload) => {
        const creds = getCredentials(ctx);
        if (!creds) return;
        const id = payload.id as string;
        const projectId = payload.projectId as string;
        void (async () => {
          const client = tryResolveTelegramClient(ctx);
          if (!client) return null;
          const listed = await client.forProject(projectId).approvals.list({ status: "pending" });
          const approval = listed.approvals.find((item) => item.id === id);
          if (!approval) return null;
          return sendApprovalMessage(
            creds.token,
            creds.chatId,
            approval,
            await renderProjectLabelPrefix(
              projectId,
              resolveTelegramProjectRouting(ctx, chatProjectBindings)?.selection,
              ctx.log,
            ),
            ctx.log,
          );
        })().then(
          (delivery) => {
            if (delivery != null) {
              pendingApprovalMessages.set(
                pendingApprovalMessageKey(creds.chatId, delivery.messageId),
                {
                  approvalId: id,
                  chatId: creds.chatId,
                  messageId: delivery.messageId,
                  projectId,
                  reviewDigest: delivery.reviewDigest,
                },
              );
            }
          },
        );
      }),
      ctx.events.subscribe("owner.question.asked", (payload) => {
        const creds = getCredentials(ctx);
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
              const creds = getCredentials(ctx);
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
    reportedTelegramPollConflicts.clear();
    pendingApprovalMessages.clear();
    pendingOwnerQuestionMessages.clear();
    for (const unsub of notificationUnsubs) unsub();
    notificationUnsubs = [];
  },
};

export default telegramModule;
