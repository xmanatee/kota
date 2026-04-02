/**
 * Telegram extension — makes KOTA accessible via Telegram messaging.
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
import type { ChannelDef } from "../channel.js";
import type { ExtensionContext, KotaExtension } from "../extension-types.js";
import { TelegramBot } from "../telegram.js";
import { callTelegramApi } from "../telegram-client.js";
import { startTelegramStatusPoll } from "../workflow/telegram-status-poll.js";

async function sendTelegramMessage(
  token: string,
  chatId: string,
  text: string,
  log: ExtensionContext["log"],
): Promise<void> {
  void callTelegramApi(token, "sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "Markdown",
  }).catch((err: unknown) => {
    log.warn(`Failed to send Telegram message: ${(err as Error).message}`);
  });
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

const telegramModule: KotaExtension = {
  name: "telegram",
  version: "1.0.0",
  description: "Telegram bot frontend for KOTA",

  channels: [telegramStatusChannel],

  onLoad: (ctx) => {
    const telegramConfig = ctx.getExtensionConfig<TelegramConfig>();
    const optInEvents = new Set(telegramConfig?.events ?? []);

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
      ctx.events.subscribe("approval.requested", (payload) => {
        const creds = getCredentials();
        if (!creds) return;
        const id = payload.id as string;
        const tool = payload.tool as string;
        const risk = payload.risk as string;
        const reason = payload.reason as string;
        const text = [
          `Approval required: *${tool}*`,
          `Risk: ${risk}`,
          `Reason: ${reason}`,
          `ID: \`${id}\``,
          ``,
          `kota approval approve ${id}`,
          `kota approval reject ${id}`,
        ].join("\n");
        void sendTelegramMessage(creds.token, creds.chatId, text, ctx.log);
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
