/**
 * Telegram extension — makes KOTA accessible via Telegram messaging.
 *
 * Contributes:
 * - `kota telegram` CLI command (interactive bot)
 * - `telegram-status` channel (daemon status poll — responds to /status)
 *
 * The CLI command starts the full interactive TelegramBot.
 * The channel contribution registers a status-only poll with the daemon
 * so operators can query workflow state via `/status` in Telegram.
 */

import { Command } from "commander";
import type { ChannelDef } from "../channel.js";
import type { KotaExtension } from "../extension-types.js";
import { TelegramBot } from "../telegram.js";
import { startTelegramStatusPoll } from "../workflow/telegram-status-poll.js";

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

const telegramModule: KotaExtension = {
  name: "telegram",
  version: "1.0.0",
  description: "Telegram bot frontend for KOTA",

  channels: [telegramStatusChannel],

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
            "Telegram bot token required. Use --token or set TELEGRAM_BOT_TOKEN env var.",
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
