/**
 * Telegram module — makes KOTA accessible via Telegram messaging.
 *
 * First module to register a CLI command via the KotaExtension protocol,
 * proving the `commands` part of the module system works end-to-end.
 * The actual bot logic lives in src/telegram.ts; this module wires
 * it into the CLI as `kota telegram`.
 */

import { Command } from "commander";
import type { KotaExtension } from "../extension-types.js";
import { TelegramBot } from "../telegram.js";

const telegramModule: KotaExtension = {
  name: "telegram",
  version: "1.0.0",
  description: "Telegram bot frontend for KOTA",

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
