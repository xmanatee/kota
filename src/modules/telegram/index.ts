/**
 * Telegram module — makes KOTA accessible via Telegram messaging.
 *
 * Contributes the interactive bot command, status channel, and configured
 * notification forwarding.
 */

import { Command } from "commander";
import type { ChannelDef } from "#core/channels/channel.js";
import { resolveChannelAutonomyMode } from "#core/config/autonomy-mode-resolver.js";
import { getOwnerQuestionQueue } from "#core/daemon/owner-question-queue.js";
import type { KotaModule, ModuleContext } from "#core/modules/module-types.js";
import { AUTONOMY_MODES, type AutonomyMode } from "#core/tools/autonomy-mode.js";
import { TelegramBot } from "./bot.js";
import { type PendingMessage, startCallbackPoll } from "./callback-poll.js";
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

async function sendOwnerQuestionMessage(
  token: string,
  chatId: string,
  id: string,
  question: string,
  reason: string,
  source: string,
  proposedAnswers: string[],
  log: ModuleContext["log"],
): Promise<number | null> {
  const text = [
    `Owner question from *${source}*`,
    `Reason: ${reason}`,
    `Question: ${question}`,
    `ID: \`${id}\``,
    ``,
    `kota owner-question answer ${id} <your answer>`,
    `kota owner-question dismiss ${id}`,
  ].join("\n");
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
  /** Autonomy mode applied to Telegram chat sessions. */
  defaultAutonomyMode?: AutonomyMode;
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
const pendingApprovalMessages = new Map<string, PendingMessage>();
const pendingOwnerQuestionMessages = new Map<string, PendingMessage>();

const telegramModule: KotaModule = {
  name: "telegram",
  version: "1.0.0",
  description: "Telegram bot frontend for KOTA",
  dependencies: ["approval-queue", "autonomy"],
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
    },
  },

  channels: [telegramStatusChannel],

  onLoad: (ctx) => {
    const telegramConfig = ctx.getModuleConfig<TelegramConfig>();
    const optInEvents = new Set(telegramConfig?.events ?? []);

    const creds = getCredentials();
    if (creds) {
      stopCallbackPoll = startCallbackPoll(
        creds.token,
        pendingApprovalMessages,
        pendingOwnerQuestionMessages,
        ctx.log,
      );
    }

    notificationUnsubs = [
      ctx.events.subscribe("workflow.failure.alert", (payload) => {
        const creds = getCredentials();
        if (!creds) return;
        void sendTelegramMessage(creds.token, creds.chatId, payload.text as string, ctx.log);
      }),
      ctx.events.subscribe("workflow.attention.digest", (payload) => {
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
      ctx.events.subscribe("owner.question.asked", (payload) => {
        const creds = getCredentials();
        if (!creds) return;
        const id = payload.id as string;
        const question = payload.question as string;
        const reason = payload.reason as string;
        const source = payload.source as string;
        const entry = getOwnerQuestionQueue().get(id);
        const proposedAnswers = entry?.proposedAnswers ?? [];
        void sendOwnerQuestionMessage(
          creds.token,
          creds.chatId,
          id,
          question,
          reason,
          source,
          proposedAnswers,
          ctx.log,
        ).then((messageId) => {
          if (messageId != null) {
            pendingOwnerQuestionMessages.set(id, { chatId: creds.chatId, messageId });
          }
        });
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
    pendingOwnerQuestionMessages.clear();
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

        const telegramConfig = ctx.getModuleConfig<TelegramConfig>();
        const autonomyMode = resolveChannelAutonomyMode(
          telegramConfig?.defaultAutonomyMode,
          ctx.config,
          "telegram",
        );

        const bot = new TelegramBot({
          token,
          model: opts.model || ctx.config.model,
          verbose: opts.verbose || ctx.config.verbose,
          config: ctx.config,
          allowedChatIds,
          autonomyMode,
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
