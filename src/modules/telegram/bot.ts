/**
 * Telegram Bot adapter — makes KOTA accessible via Telegram messaging.
 *
 * Uses the Telegram Bot API via HTTP (no external dependencies).
 * One AgentSession per chat, ProxyTransport pattern (same as HTTP server).
 * Long polling for receiving messages, typing indicators while processing.
 * Scheduler integration delivers reminders and action results to active chats.
 */

import type { ChannelSession, ChannelUserIdentity } from "#core/channels/channel.js";
import type { KotaConfig } from "#core/config/config.js";
import { getScheduler, initScheduler, resetScheduler } from "#core/daemon/scheduler.js";
import { AgentSession, type LoopOptions } from "#core/loop/loop.js";
import { NullTransport, ProxyTransport } from "#core/loop/transport.js";
import {
  callTelegramApi,
  ERROR_BACKOFF_MS,
  POLL_TIMEOUT_S,
  SCHEDULER_CHECK_MS,
  splitMessage,
  TelegramTransport,
  type TelegramUpdate,
  type TelegramUser,
} from "./client.js";

export { callTelegramApi, splitMessage, TelegramTransport };

// --- Chat session management ---

export type TelegramBotOptions = {
  token: string;
  model?: string;
  verbose?: boolean;
  config?: KotaConfig;
  /** Whitelist of allowed chat IDs. Empty/undefined = allow all. */
  allowedChatIds?: number[];
};

// --- TelegramBot ---

export class TelegramBot {
  private token: string;
  private sessions = new Map<number, ChannelSession>();
  private busyChats = new Set<number>();
  private running = false;
  private offset = 0;
  private options: TelegramBotOptions;
  private stopSchedulerTimer: (() => void) | null = null;

  constructor(options: TelegramBotOptions) {
    this.token = options.token;
    this.options = options;
  }

  async start(): Promise<void> {
    this.running = true;
    const me = await callTelegramApi<TelegramUser>(this.token, "getMe");
    console.log(`[kota-telegram] Bot: @${me.username ?? me.first_name}`);
    console.log("[kota-telegram] Listening for messages...");

    this.startScheduler();

    while (this.running) {
      try {
        await this.poll();
      } catch (err) {
        if (!this.running) break;
        console.error("[kota-telegram] Poll error:", (err as Error).message);
        await sleep(ERROR_BACKOFF_MS);
      }
    }
  }

  stop(): void {
    this.running = false;
    if (this.stopSchedulerTimer) {
      this.stopSchedulerTimer();
      this.stopSchedulerTimer = null;
    }
    resetScheduler();
    for (const session of this.sessions.values()) {
      session.agent.close();
    }
    this.sessions.clear();
  }

  get sessionCount(): number {
    return this.sessions.size;
  }

  /** Start the scheduler timer for reminders. */
  private startScheduler(): void {
    initScheduler(process.cwd());
    const scheduler = getScheduler();

    this.stopSchedulerTimer = scheduler.startTimer(SCHEDULER_CHECK_MS, (dueItems) => {
      if (!this.running) return;
      for (const item of dueItems) {
        this.broadcastToChats(`\u23f0 Reminder: ${item.description}`);
      }
    });

    if (this.options.verbose) {
      console.log("[kota-telegram] Scheduler started (checking every 30s)");
    }
  }

  /** Send a message to all active chat sessions. */
  private broadcastToChats(text: string): void {
    for (const chatId of this.sessions.keys()) {
      this.sendText(chatId, text);
    }
  }

  private async poll(): Promise<void> {
    const updates = await callTelegramApi<TelegramUpdate[]>(this.token, "getUpdates", {
      offset: this.offset,
      timeout: POLL_TIMEOUT_S,
      allowed_updates: ["message"],
    });

    for (const update of updates) {
      this.offset = update.update_id + 1;
      if (update.message?.text) {
        this.handleMessage(update.message.chat.id, update.message.text, update.message.chat.first_name);
      }
    }
  }

  private handleMessage(chatId: number, text: string, firstName?: string): void {
    if (this.options.allowedChatIds?.length && !this.options.allowedChatIds.includes(chatId)) {
      this.sendText(chatId, "Sorry, I'm not authorized to chat with you.");
      return;
    }

    if (text === "/start") {
      this.sendText(
        chatId,
        `Hi ${firstName ?? "there"}! I'm KOTA, your AI assistant. Send me any message.\n\n` +
          `/clear \u2014 New conversation\n/status \u2014 Session info`,
      );
      return;
    }

    if (text === "/clear") {
      const session = this.sessions.get(chatId);
      if (session) {
        session.agent.close();
        this.sessions.delete(chatId);
      }
      this.sendText(chatId, "Conversation cleared.");
      return;
    }

    if (text === "/status") {
      const session = this.sessions.get(chatId);
      const busy = this.busyChats.has(chatId);
      const scheduler = getScheduler();
      const pendingCount = scheduler.count();
      const statusParts = [
        session
          ? `Active session (${busy ? "processing" : "idle"}). Cost: ${session.agent.getCostSummary()}`
          : "No active session. Send a message to start one.",
      ];
      if (pendingCount > 0) {
        statusParts.push(`${pendingCount} pending reminder(s)`);
      }
      this.sendText(chatId, statusParts.join("\n"));
      return;
    }

    // Skip bot commands we don't handle
    if (text.startsWith("/")) return;

    this.processMessage(chatId, text, firstName).catch((err) => {
      console.error(`[kota-telegram] Error in chat ${chatId}:`, (err as Error).message);
      this.sendText(chatId, "Something went wrong. Try again or /clear to start over.");
    });
  }

  private async processMessage(chatId: number, text: string, firstName?: string): Promise<void> {
    if (this.busyChats.has(chatId)) {
      this.sendText(chatId, "Still working on your previous message. Please wait.");
      return;
    }

    this.busyChats.add(chatId);
    const transport = new TelegramTransport(chatId, this.token);

    try {
      const session = this.getOrCreateSession(chatId, firstName);
      session.proxy.target = transport;
      session.lastActive = Date.now();

      transport.startTyping();
      await session.agent.send(text);
      await transport.flush();
    } catch (err) {
      // Flush any partial output the agent produced before the error
      try {
        await transport.flush();
      } catch (flushErr) {
        console.error("[kota-telegram] Failed to flush partial output after error:", (flushErr as Error).message);
      }
      throw err;
    } finally {
      const session = this.sessions.get(chatId);
      if (session) session.proxy.target = new NullTransport();
      transport.stopTyping();
      this.busyChats.delete(chatId);
    }
  }

  private getOrCreateSession(chatId: number, firstName?: string): ChannelSession {
    let session = this.sessions.get(chatId);
    if (session) return session;

    const identity: ChannelUserIdentity = {
      channelUserId: String(chatId),
      displayName: firstName,
      channel: "telegram",
    };
    const proxy = new ProxyTransport();
    const loopOpts: LoopOptions = {
      autonomyMode: "supervised",
      model: this.options.model ?? this.options.config?.model,
      verbose: this.options.verbose ?? this.options.config?.verbose,
      transport: proxy,
      config: this.options.config,
      channelIdentity: identity,
    };
    session = {
      agent: new AgentSession(loopOpts),
      proxy,
      lastActive: Date.now(),
      identity,
    };
    this.sessions.set(chatId, session);
    return session;
  }

  private sendText(chatId: number, text: string): void {
    callTelegramApi(this.token, "sendMessage", {
      chat_id: chatId,
      text,
    }).catch((err) => {
      console.error(`[kota-telegram] Failed to send to ${chatId}:`, (err as Error).message);
    });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
