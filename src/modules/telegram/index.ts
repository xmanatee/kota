/**
 * Telegram module — makes KOTA accessible via Telegram messaging.
 *
 * Contributes:
 * - `kota telegram` CLI command (interactive bot)
 * - `telegram-status` channel (daemon status poll — responds to /status)
 * - Notification subscriptions for workflow events (failure alerts, budget alerts,
 *   attention digests, cost limit alerts, approval requests)
 *
 * The CLI command starts the full interactive TelegramBot.
 * The channel contribution registers a status-only poll with the daemon
 * so operators can query workflow state via `/status` in Telegram.
 * The onLoad handler subscribes to domain bus events and forwards them to Telegram.
 */

import { Command } from "commander";
import type { ChannelDef } from "#core/channels/channel.js";
import type { KotaModule, ModuleContext } from "#core/modules/module-types.js";
import {
  type PendingApprovalMessage,
  startApprovalCallbackPoll,
} from "./approval-callback-poll.js";
import { TelegramBot } from "./bot.js";
import type { TelegramMessage } from "./client.js";
import { callTelegramApi } from "./client.js";
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

async function sendApprovalMessage(
  token: string,
  chatId: string,
  approvalId: string,
  tool: string,
  risk: string,
  reason: string,
  log: ModuleContext["log"],
): Promise<number | null> {
  const text = [
    `Approval required: *${tool}*`,
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
};

function getCredentials(): { token: string; chatId: string } | null {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_ALERT_CHAT_ID;
  if (!token || !chatId) return null;
  return { token, chatId };
}

const telegramStatusChannel: ChannelDef = {
  name: "telegram-status",
  description: "Responds to /status commands in Telegram with current workflow state",
  create(ctx) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_ALERT_CHAT_ID;
    if (!token || !chatId) return null;

    let stop: (() => void) | null = null;
    return {
      async start() {
        stop = startTelegramStatusPoll(token, chatId, ctx.getWorkflowStatus, ctx.log);
      },
      stop() {
        stop?.();
      },
    };
  },
};

let notificationUnsubs: (() => void)[] = [];
let stopCallbackPoll: (() => void) | null = null;
const pendingApprovalMessages = new Map<string, PendingApprovalMessage>();

const telegramModule: KotaModule = {
  name: "telegram",
  version: "1.0.0",
  description: "Telegram bot frontend for KOTA",
  dependencies: ["approval-queue", "autonomy"],

  channels: [telegramStatusChannel],

  onLoad: (ctx) => {
    const telegramConfig = ctx.getModuleConfig<TelegramConfig>();
    const optInEvents = new Set(telegramConfig?.events ?? []);

    const creds = getCredentials();
    if (creds) {
      stopCallbackPoll = startApprovalCallbackPoll(
        creds.token,
        pendingApprovalMessages,
        ctx.log,
      );
    }

    notificationUnsubs = [
      ctx.events.subscribe("workflow.failure.alert", (payload) => {
        const creds = getCredentials();
        if (!creds) return;
        void sendTelegramMessage(creds.token, creds.chatId, payload.text as string, ctx.log);
      }),
      ctx.events.subscribe("workflow.budget.exceeded", (payload) => {
        const creds = getCredentials();
        if (!creds) return;
        void sendTelegramMessage(creds.token, creds.chatId, payload.text as string, ctx.log);
      }),
      ctx.events.subscribe("workflow.budget.warning", (payload) => {
        const creds = getCredentials();
        if (!creds) return;
        void sendTelegramMessage(creds.token, creds.chatId, payload.text as string, ctx.log);
      }),
      ctx.events.subscribe("workflow.attention.digest", (payload) => {
        const creds = getCredentials();
        if (!creds) return;
        void sendTelegramMessage(creds.token, creds.chatId, payload.text as string, ctx.log);
      }),
      ctx.events.subscribe("workflow.cost.limit.reached", (payload) => {
        const creds = getCredentials();
        if (!creds) return;
        void sendTelegramMessage(creds.token, creds.chatId, payload.text as string, ctx.log);
      }),
      ctx.events.subscribe("workflow.cost.anomaly", (payload) => {
        const creds = getCredentials();
        if (!creds) return;
        void sendTelegramMessage(creds.token, creds.chatId, payload.text as string, ctx.log);
      }),
      ctx.events.subscribe("workflow.approval.expired", (payload) => {
        const creds = getCredentials();
        if (!creds) return;
        void sendTelegramMessage(creds.token, creds.chatId, payload.text as string, ctx.log);
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
        void sendApprovalMessage(creds.token, creds.chatId, id, tool, risk, reason, ctx.log).then(
          (messageId) => {
            if (messageId != null) {
              pendingApprovalMessages.set(id, { chatId: creds.chatId, messageId });
            }
          },
        );
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
              void sendTelegramMessage(creds.token, creds.chatId, text, ctx.log);
            }),
          ]
        : []),
    ];
  },

  onUnload: () => {
    stopCallbackPoll?.();
    stopCallbackPoll = null;
    pendingApprovalMessages.clear();
    for (const unsub of notificationUnsubs) unsub();
    notificationUnsubs = [];
  },

  commands: (ctx) => {
    const cmd = new Command("telegram")
      .description("Run KOTA as a Telegram bot")
      .option(
        "-t, --token <token>",
        "Telegram bot token (or set TELEGRAM_BOT_TOKEN env var)",
      )
      .option("-m, --model <model>", "Model to use")
      .option("-v, --verbose", "Show debug output")
      .option(
        "--allowed-chats <ids>",
        "Comma-separated list of allowed chat IDs",
      )
      .action(async (opts) => {
        if (!process.env.ANTHROPIC_API_KEY) {
          console.error(
            "Error: ANTHROPIC_API_KEY environment variable is not set.\n",
          );
          console.error("To get started:");
          console.error(
            "  1. Get your API key at https://console.anthropic.com/settings/keys",
          );
          console.error("  2. Export it in your shell:\n");
          console.error("     export ANTHROPIC_API_KEY=sk-ant-...\n");
          process.exit(1);
        }

        const token = opts.token || process.env.TELEGRAM_BOT_TOKEN;
        if (!token) {
          console.error(
            "Telegram bot token required. Use --token or set TELEGRAM_BOT_TOKEN.",
          );
          process.exit(1);
        }

        const allowedChatIds = opts.allowedChats
          ? opts.allowedChats
              .split(",")
              .map((id: string) => Number.parseInt(id.trim(), 10))
              .filter(Number.isFinite)
          : undefined;

        const bot = new TelegramBot({
          token,
          model: opts.model || ctx.config.model,
          verbose: opts.verbose || ctx.config.verbose,
          config: ctx.config,
          allowedChatIds,
        });

        process.on("SIGINT", () => {
          console.log("\n[kota-telegram] Shutting down...");
          bot.stop();
          process.exit(0);
        });

        await bot.start();
      });

    return [cmd];
  },
};

export default telegramModule;
