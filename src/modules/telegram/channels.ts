import type { ChannelDef } from "#core/channels/channel.js";
import { resolveChannelAutonomyMode } from "#core/config/autonomy-mode-resolver.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import { TelegramBot, TelegramGetUpdatesConflictError } from "./bot.js";
import { createTelegramCallbackHandler, type PendingApprovalMessage } from "./callback-poll.js";
import { callTelegramApi } from "./client.js";
import { renderScopeLabelPrefix } from "./notification-delivery.js";
import { type PendingMessage, tryHandleOwnerQuestionReply } from "./owner-question-reply.js";
import { emitTelegramPollConflictHealthSignal, getCredentials, type TelegramConfig, telegramInteractiveBackendError } from "./readiness.js";
import { resolveTelegramScopeRouting, tryResolveTelegramClient } from "./scope-routing.js";
import type { TelegramChatScopeBinding } from "./scope-selection.js";
import { buildStatusText, handleTelegramStatusCommand, type TelegramStatusScope } from "./status-poll.js";

export function makeTelegramStatusChannel(
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
          listScopeSessionIds: () => [],
          async start() {},
          stop() {},
        },
      };
    },
  };
}

export function makeTelegramInteractiveChannel(
  ctx: ModuleContext,
  chatScopeBindings: TelegramChatScopeBinding[],
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
      const scopeRouting = resolveTelegramScopeRouting(
        ctx,
        chatScopeBindings,
      );
      const bot = new TelegramBot({
        token,
        model: ctx.config.model,
        verbose: ctx.verbose || ctx.config.verbose,
        config: ctx.config,
        autonomyMode,
        moduleLoader: channelCtx.moduleLoader,
        pollOwner: {
          owner: "telegram-interactive",
          source: "daemon channel",
        },
        defaultScopeRuntime: channelCtx.getDefaultScopeRuntime(),
        getScopeRuntime: channelCtx.getScopeRuntime,
        allowedChatIds,
        scopeSelection: scopeRouting?.selection,
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
            scopeRoot: channelCtx.getDefaultScopeRuntime().scope.scopeRoot,
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
            scopeRouting,
          });
        },
      });

      const unsubscribeSchedule = ctx.events.subscribe("schedule.fire", (payload) => {
        const description = typeof payload.description === "string"
          ? payload.description
          : JSON.stringify(payload);
        const scopeId = typeof payload.scopeId === "string" ? payload.scopeId : undefined;
        void (async () => {
          const prefix = await renderScopeLabelPrefix(
            scopeId,
            scopeRouting?.selection,
            ctx.log,
          );
          bot.broadcastToChats(`${prefix}⏰ Reminder: ${description}`, scopeId);
        })();
      });
      const unsubscribeScopeLifecycle = ctx.events.subscribe(
        "scope.lifecycle.changed",
        (payload) => {
          if (
            scopeRouting ||
            payload.transition !== "default-changed" ||
            payload.previousDefaultScopeId === undefined
          ) return;
          bot.setDefaultScopeRuntime(channelCtx.getDefaultScopeRuntime());
          bot.closeScopeSessions(payload.previousDefaultScopeId);
        },
      );

      let startPromise: Promise<void> | null = null;
      return {
        status: "started",
        adapter: {
          listScopeSessionIds: (scopeId) => bot.listScopeSessionIds(scopeId),
          async start() {
            startPromise = bot.start().catch((err) => {
              const message = (err as Error).message;
              if (err instanceof TelegramGetUpdatesConflictError) {
                emitTelegramPollConflictHealthSignal(
                  ctx,
                  channelCtx.getDefaultScopeRuntime().scope.scopeId,
                );
              }
              ctx.log.error(`telegram-interactive channel poll loop exited: ${message}`);
              channelCtx.reportFailure(message);
            });
          },
          async stop() {
            unsubscribeSchedule();
            unsubscribeScopeLifecycle();
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

export const pendingApprovalMessages = new Map<string, PendingApprovalMessage>();
export const pendingOwnerQuestionMessages = new Map<string, PendingMessage>();
