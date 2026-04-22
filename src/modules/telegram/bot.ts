/**
 * Telegram Bot adapter — makes KOTA accessible via Telegram messaging.
 *
 * Uses the Telegram Bot API via HTTP (no external dependencies).
 * One AgentSession per chat, ProxyTransport pattern (same as HTTP server).
 * Long polling for receiving messages, typing indicators while processing.
 *
 * The bot does not own a scheduler. Callers that host the bot (the telegram
 * channel inside the daemon) subscribe to scheduler events on the bus and
 * invoke `broadcastToChats` to deliver reminders to active sessions.
 */

import type { ChannelSession, ChannelUserIdentity } from "#core/channels/channel.js";
import type { KotaConfig } from "#core/config/config.js";
import { getScheduler } from "#core/daemon/scheduler.js";
import { AgentSession, type LoopOptions } from "#core/loop/loop.js";
import { NullTransport, ProxyTransport } from "#core/loop/transport.js";
import type { AutonomyMode } from "#core/tools/autonomy-mode.js";
import {
  TranscriptionProviderUnavailableError,
  transcribeAudio,
} from "#modules/transcription/index.js";
import {
  callTelegramApi,
  downloadTelegramFile,
  ERROR_BACKOFF_MS,
  POLL_TIMEOUT_S,
  splitMessage,
  type TelegramAudio,
  type TelegramMessage,
  TelegramTransport,
  type TelegramUpdate,
  type TelegramUser,
  type TelegramVoice,
} from "./client.js";

export { callTelegramApi, splitMessage, TelegramTransport };

// --- Chat session management ---

export type TelegramBotOptions = {
  token: string;
  model?: string;
  verbose?: boolean;
  config?: KotaConfig;
  autonomyMode: AutonomyMode;
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

  constructor(options: TelegramBotOptions) {
    this.token = options.token;
    this.options = options;
  }

  async start(): Promise<void> {
    this.running = true;
    const me = await callTelegramApi<TelegramUser>(this.token, "getMe");
    console.log(`[kota-telegram] Bot: @${me.username ?? me.first_name}`);
    console.log("[kota-telegram] Listening for messages...");

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
    for (const session of this.sessions.values()) {
      session.agent.close();
    }
    this.sessions.clear();
  }

  get sessionCount(): number {
    return this.sessions.size;
  }

  /** Send a message to every active chat session. */
  broadcastToChats(text: string): void {
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
      if (!update.message) continue;
      if (update.message.text) {
        this.handleMessage(update.message.chat.id, update.message.text, update.message.chat.first_name);
        continue;
      }
      if (update.message.voice || update.message.audio) {
        void this.handleVoiceMessage(update.message).catch((err) => {
          console.error(
            `[kota-telegram] Voice handling error in chat ${update.message?.chat.id}:`,
            (err as Error).message,
          );
        });
      }
    }
  }

  private async handleVoiceMessage(message: TelegramMessage): Promise<void> {
    const chatId = message.chat.id;
    if (this.options.allowedChatIds?.length && !this.options.allowedChatIds.includes(chatId)) {
      this.sendText(chatId, "Sorry, I'm not authorized to chat with you.");
      return;
    }

    const media: TelegramVoice | TelegramAudio | undefined = message.voice ?? message.audio;
    if (!media) return;
    const defaultMime = message.voice ? "audio/ogg" : "audio/mpeg";
    const mimeType = media.mime_type ?? defaultMime;
    const filename = "file_name" in media && media.file_name ? media.file_name : undefined;

    let download: Awaited<ReturnType<typeof downloadTelegramFile>>;
    try {
      download = await downloadTelegramFile(this.token, media.file_id);
    } catch (err) {
      this.sendText(
        chatId,
        `Couldn't download your voice message: ${(err as Error).message}`,
      );
      return;
    }

    let transcript: string;
    try {
      const result = await transcribeAudio({
        audio: download.bytes,
        mimeType: download.mimeType ?? mimeType,
        filename,
      });
      transcript = result.text.trim();
    } catch (err) {
      if (err instanceof TranscriptionProviderUnavailableError) {
        this.sendText(
          chatId,
          "Voice transcription isn't configured on this KOTA deployment. Please send your message as text.",
        );
        return;
      }
      this.sendText(chatId, `Voice transcription failed: ${(err as Error).message}`);
      return;
    }

    if (!transcript) {
      this.sendText(chatId, "I couldn't hear anything in that voice message. Please try again.");
      return;
    }

    this.sendText(chatId, `\u{1F3A4} Transcribed: ${transcript}`);
    this.handleMessage(chatId, transcript, message.chat.first_name);
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
          `/clear — New conversation\n/status — Session info`,
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
      autonomyMode: this.options.autonomyMode,
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
