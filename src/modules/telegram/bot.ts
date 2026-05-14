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
import type { ProjectRuntime } from "#core/daemon/project-runtime.js";
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
import type { TelegramProjectSelection } from "./project-selection.js";

export { callTelegramApi, splitMessage, TelegramTransport };

// --- Chat session management ---

export type TelegramBotOptions = {
  token: string;
  model?: string;
  verbose?: boolean;
  config?: KotaConfig;
  autonomyMode: AutonomyMode;
  /** Default daemon-owned runtime bundle used for single-project Telegram sessions. */
  defaultProjectRuntime: ProjectRuntime;
  /** Resolve the daemon-owned runtime bundle for a selected project id. */
  getProjectRuntime: (projectId: string) => ProjectRuntime;
  /** Whitelist of allowed chat IDs. Empty/undefined = allow all. */
  allowedChatIds?: number[];
  projectSelection?: TelegramProjectSelection;
  /**
   * Hook invoked when a text message is a Telegram chat reply. If the hook
   * returns true, the message is considered consumed (e.g. it resolved a
   * pending owner question) and is not routed to the interactive session.
   * Returning false falls through to normal message handling.
   */
  onChatReply?: (
    chatId: number,
    replyToMessageId: number,
    text: string,
  ) => Promise<boolean>;
};

type TelegramProjectTarget = {
  chatId: number;
  projectId: string;
  projectDir: string;
  projectRuntime: ProjectRuntime;
  sessionKey: string;
};

type TelegramProjectTargetResolution =
  | { ok: true; target: TelegramProjectTarget }
  | { ok: false; message: string };

// --- TelegramBot ---

export class TelegramBot {
  private token: string;
  private sessions = new Map<string, ChannelSession>();
  private busyChats = new Set<string>();
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

  /** Send a message to active chat sessions, optionally scoped to one project. */
  broadcastToChats(text: string, projectId?: string): void {
    for (const [key, session] of this.sessions) {
      const meta = session.identity?.meta;
      const sessionProjectId = typeof meta?.projectId === "string" ? meta.projectId : "";
      if (projectId !== undefined && sessionProjectId !== projectId) continue;
      const chatId = Number.parseInt(key.split(":")[0]!, 10);
      if (Number.isFinite(chatId)) this.sendText(chatId, text);
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
      const message = update.message;
      if (!message) continue;
      const text = message.text;
      if (text !== undefined) {
        const chatId = message.chat.id;
        const firstName = message.chat.first_name;
        const replyToId = message.reply_to_message?.message_id;
        if (replyToId !== undefined && this.options.onChatReply) {
          void this.options
            .onChatReply(chatId, replyToId, text)
            .then((handled) => {
              if (handled) return;
              this.handleMessage(chatId, text, firstName);
            })
            .catch((err) => {
              console.error(
                `[kota-telegram] Chat-reply handler error in chat ${chatId}:`,
                (err as Error).message,
              );
              this.handleMessage(chatId, text, firstName);
            });
          continue;
        }
        this.handleMessage(chatId, text, firstName);
        continue;
      }
      if (message.voice || message.audio) {
        void this.handleVoiceMessage(message).catch((err) => {
          console.error(
            `[kota-telegram] Voice handling error in chat ${message.chat.id}:`,
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
    const resolved = await this.resolveProjectTarget(chatId);
    if (!resolved.ok) {
      this.sendText(chatId, resolved.message);
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
    this.handleMessage(chatId, transcript, message.chat.first_name, resolved.target);
  }

  private handleMessage(
    chatId: number,
    text: string,
    firstName?: string,
    resolvedTarget?: TelegramProjectTarget,
  ): void {
    if (this.options.allowedChatIds?.length && !this.options.allowedChatIds.includes(chatId)) {
      this.sendText(chatId, "Sorry, I'm not authorized to chat with you.");
      return;
    }

    if (text === "/project" || text.startsWith("/project ")) {
      this.handleProjectCommand(chatId, text).catch((err) => {
        console.error(`[kota-telegram] Project switch error in chat ${chatId}:`, (err as Error).message);
        this.sendText(chatId, "Project selection failed.");
      });
      return;
    }

    const targetPromise = resolvedTarget
      ? Promise.resolve({ ok: true as const, target: resolvedTarget })
      : this.resolveProjectTarget(chatId);

    if (text === "/start") {
      targetPromise.then((resolved) => {
        if (!resolved.ok) {
          this.sendText(chatId, resolved.message);
          return;
        }
        this.sendText(
          chatId,
          `Hi ${firstName ?? "there"}! I'm KOTA, your AI assistant. Send me any message.\n\n` +
            `/clear — New conversation\n/status — Session info`,
        );
      }).catch((err) => {
        console.error(`[kota-telegram] Project resolution error in chat ${chatId}:`, (err as Error).message);
        this.sendText(chatId, "Project selection failed.");
      });
      return;
    }

    if (text === "/clear") {
      targetPromise.then((resolved) => {
        if (!resolved.ok) {
          this.sendText(chatId, resolved.message);
          return;
        }
        const session = this.sessions.get(resolved.target.sessionKey);
        if (session) {
          session.agent.close();
          this.sessions.delete(resolved.target.sessionKey);
        }
        this.sendText(chatId, "Conversation cleared.");
      }).catch((err) => {
        console.error(`[kota-telegram] Project resolution error in chat ${chatId}:`, (err as Error).message);
        this.sendText(chatId, "Project selection failed.");
      });
      return;
    }

    if (text === "/status") {
      targetPromise.then((resolved) => {
        if (!resolved.ok) {
          this.sendText(chatId, resolved.message);
          return;
        }
        const session = this.sessions.get(resolved.target.sessionKey);
        const busy = this.busyChats.has(resolved.target.sessionKey);
        const pendingCount = resolved.target.projectRuntime.scheduler.count();
        const statusParts = [
          session
            ? `Active session (${busy ? "processing" : "idle"}). Cost: ${session.agent.getCostSummary()}`
            : "No active session. Send a message to start one.",
        ];
        if (pendingCount > 0) {
          statusParts.push(`${pendingCount} pending reminder(s)`);
        }
        this.sendText(chatId, statusParts.join("\n"));
      }).catch((err) => {
        console.error(`[kota-telegram] Project resolution error in chat ${chatId}:`, (err as Error).message);
        this.sendText(chatId, "Project selection failed.");
      });
      return;
    }

    // Skip bot commands we don't handle
    if (text.startsWith("/")) return;

    targetPromise.then((resolved) => {
      if (!resolved.ok) {
        this.sendText(chatId, resolved.message);
        return;
      }
      this.processMessage(resolved.target, text, firstName).catch((err) => {
        console.error(`[kota-telegram] Error in chat ${chatId}:`, (err as Error).message);
        this.sendText(chatId, "Something went wrong. Try again or /clear to start over.");
      });
    }).catch((err) => {
      console.error(`[kota-telegram] Project resolution error in chat ${chatId}:`, (err as Error).message);
      this.sendText(chatId, "Project selection failed.");
    });
  }

  private async processMessage(
    target: TelegramProjectTarget,
    text: string,
    firstName?: string,
  ): Promise<void> {
    if (this.busyChats.has(target.sessionKey)) {
      this.sendText(target.chatId, "Still working on your previous message. Please wait.");
      return;
    }

    this.busyChats.add(target.sessionKey);
    const transport = new TelegramTransport(target.chatId, this.token);

    try {
      const session = this.getOrCreateSession(target, firstName);
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
      const session = this.sessions.get(target.sessionKey);
      if (session) session.proxy.target = new NullTransport();
      transport.stopTyping();
      this.busyChats.delete(target.sessionKey);
    }
  }

  private getOrCreateSession(target: TelegramProjectTarget, firstName?: string): ChannelSession {
    let session = this.sessions.get(target.sessionKey);
    if (session) return session;

    const identity: ChannelUserIdentity = {
      channelUserId: String(target.chatId),
      displayName: firstName,
      channel: "telegram",
      meta: { projectId: target.projectId },
    };
    const proxy = new ProxyTransport();
    const loopOpts: LoopOptions = {
      autonomyMode: this.options.autonomyMode,
      model: this.options.model ?? this.options.config?.model,
      verbose: this.options.verbose ?? this.options.config?.verbose,
      transport: proxy,
      config: this.options.config,
      channelIdentity: identity,
      projectDir: target.projectDir,
      projectRuntime: target.projectRuntime,
    };
    session = {
      agent: new AgentSession(loopOpts),
      proxy,
      lastActive: Date.now(),
      identity,
    };
    this.sessions.set(target.sessionKey, session);
    return session;
  }

  private async resolveProjectTarget(chatId: number): Promise<TelegramProjectTargetResolution> {
    if (!this.options.projectSelection) {
      const runtime = this.options.defaultProjectRuntime;
      return {
        ok: true,
        target: {
          chatId,
          projectId: runtime.project.projectId,
          projectDir: runtime.project.projectDir,
          projectRuntime: runtime,
          sessionKey: `${chatId}:${runtime.project.projectId}`,
        },
      };
    }
    const resolved = await this.options.projectSelection.resolveChat(chatId);
    if (!resolved.ok) return resolved;
    let projectRuntime: ProjectRuntime;
    try {
      projectRuntime = this.options.getProjectRuntime(resolved.project.projectId);
    } catch (err) {
      return {
        ok: false,
        message: `Telegram project "${resolved.project.projectId}" is not available in this daemon runtime: ${(err as Error).message}`,
      };
    }
    return {
      ok: true,
      target: {
        chatId,
        projectId: resolved.project.projectId,
        projectDir: resolved.project.projectDir,
        projectRuntime,
        sessionKey: `${chatId}:${resolved.project.projectId}`,
      },
    };
  }

  private async handleProjectCommand(chatId: number, text: string): Promise<void> {
    if (!this.options.projectSelection) return;
    const before = await this.resolveProjectTarget(chatId);
    const requested = text === "/project" ? "" : text.slice("/project ".length);
    const result = await this.options.projectSelection.switchChat(chatId, requested);
    this.sendText(chatId, result.message);
    if (!result.ok || !result.changed) return;
    if (before.ok) this.closeSessionsForChat(chatId);
  }

  private closeSessionsForChat(chatId: number): void {
    const prefix = `${chatId}:`;
    for (const [key, session] of this.sessions) {
      if (!key.startsWith(prefix)) continue;
      session.agent.close();
      this.sessions.delete(key);
      this.busyChats.delete(key);
    }
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
