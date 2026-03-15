/**
 * Telegram Bot adapter — makes KOTA accessible via Telegram messaging.
 *
 * Uses the Telegram Bot API via HTTP (no external dependencies).
 * One AgentSession per chat, ProxyTransport pattern (same as HTTP server).
 * Long polling for receiving messages, typing indicators while processing.
 */

import { AgentSession, type LoopOptions } from "./loop.js";
import { NullTransport, ProxyTransport, type Transport, type AgentEvent } from "./transport.js";
import { type KotaConfig } from "./config.js";

const TELEGRAM_API = "https://api.telegram.org";
const MAX_MESSAGE_LENGTH = 4096;
const TYPING_INTERVAL_MS = 4000;
const POLL_TIMEOUT_S = 30;
const ERROR_BACKOFF_MS = 5000;

// --- Telegram API types (minimal subset) ---

type TelegramUser = { id: number; first_name: string; username?: string };

type TelegramChat = { id: number; first_name?: string; username?: string; type: string };

type TelegramMessage = {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  text?: string;
  date: number;
};

type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
};

type TelegramApiResponse<T> = {
  ok: boolean;
  result: T;
  description?: string;
};

// --- Telegram API client ---

export async function callTelegramApi<T>(
  token: string,
  method: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const url = `${TELEGRAM_API}/bot${token}/${method}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json()) as TelegramApiResponse<T>;
  if (!data.ok) throw new Error(`Telegram API ${method}: ${data.description}`);
  return data.result;
}

// --- Message splitting ---

/** Split text into chunks that fit Telegram's message size limit. */
export function splitMessage(text: string, maxLen = MAX_MESSAGE_LENGTH): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    // Split at last newline within limit
    let splitAt = remaining.lastIndexOf("\n", maxLen);
    if (splitAt <= 0) splitAt = maxLen;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).replace(/^\n/, "");
  }
  return chunks;
}

// --- TelegramTransport ---

/**
 * Transport that buffers agent text output, shows typing indicators,
 * and flushes the accumulated response as Telegram messages.
 */
export class TelegramTransport implements Transport {
  private buffer = "";
  private typingTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private chatId: number,
    private token: string,
  ) {}

  emit(event: AgentEvent): void {
    if (event.type === "text") {
      this.buffer += event.content;
    }
    // status, cost, thinking, etc. — skip (noisy for chat)
  }

  startTyping(): void {
    this.sendTypingAction();
    this.typingTimer = setInterval(() => this.sendTypingAction(), TYPING_INTERVAL_MS);
  }

  stopTyping(): void {
    if (this.typingTimer) {
      clearInterval(this.typingTimer);
      this.typingTimer = null;
    }
  }

  async flush(): Promise<void> {
    this.stopTyping();
    const text = this.buffer.trim();
    this.buffer = "";
    if (!text) return;
    const chunks = splitMessage(text);
    for (const chunk of chunks) {
      await callTelegramApi(this.token, "sendMessage", {
        chat_id: this.chatId,
        text: chunk,
      });
    }
  }

  getBuffer(): string {
    return this.buffer;
  }

  private sendTypingAction(): void {
    callTelegramApi(this.token, "sendChatAction", {
      chat_id: this.chatId,
      action: "typing",
    }).catch(() => {});
  }
}

// --- Chat session management ---

type ChatSession = {
  agent: AgentSession;
  proxy: ProxyTransport;
  lastActive: number;
};

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
  private sessions = new Map<number, ChatSession>();
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
      this.sendText(
        chatId,
        session
          ? `Active session (${busy ? "processing" : "idle"}). Cost: ${session.agent.getCostSummary()}`
          : "No active session. Send a message to start one.",
      );
      return;
    }

    // Skip bot commands we don't handle
    if (text.startsWith("/")) return;

    this.processMessage(chatId, text).catch((err) => {
      console.error(`[kota-telegram] Error in chat ${chatId}:`, (err as Error).message);
      this.sendText(chatId, "Something went wrong. Try again or /clear to start over.");
    });
  }

  private async processMessage(chatId: number, text: string): Promise<void> {
    if (this.busyChats.has(chatId)) {
      this.sendText(chatId, "Still working on your previous message. Please wait.");
      return;
    }

    this.busyChats.add(chatId);
    const transport = new TelegramTransport(chatId, this.token);

    try {
      const session = this.getOrCreateSession(chatId);
      session.proxy.target = transport;
      session.lastActive = Date.now();

      transport.startTyping();
      await session.agent.send(text);
      await transport.flush();
    } finally {
      const session = this.sessions.get(chatId);
      if (session) session.proxy.target = new NullTransport();
      transport.stopTyping();
      this.busyChats.delete(chatId);
    }
  }

  private getOrCreateSession(chatId: number): ChatSession {
    let session = this.sessions.get(chatId);
    if (session) return session;

    const proxy = new ProxyTransport();
    const loopOpts: LoopOptions = {
      model: this.options.model ?? this.options.config?.model,
      verbose: this.options.verbose ?? this.options.config?.verbose,
      transport: proxy,
      config: this.options.config,
    };
    session = {
      agent: new AgentSession(loopOpts),
      proxy,
      lastActive: Date.now(),
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
