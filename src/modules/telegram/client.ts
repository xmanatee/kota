import type { AgentEvent, Transport } from "#core/loop/transport.js";

export const TELEGRAM_API = "https://api.telegram.org";
export const MAX_MESSAGE_LENGTH = 4096;
export const TYPING_INTERVAL_MS = 4000;
export const POLL_TIMEOUT_S = 30;
export const ERROR_BACKOFF_MS = 5000;
export const SCHEDULER_CHECK_MS = 30_000;

// --- Telegram API types (minimal subset) ---

export type TelegramUser = { id: number; first_name: string; username?: string };

export type TelegramChat = { id: number; first_name?: string; username?: string; type: string };

export type TelegramVoice = {
  file_id: string;
  duration: number;
  mime_type?: string;
  file_size?: number;
};

export type TelegramAudio = {
  file_id: string;
  duration: number;
  mime_type?: string;
  file_name?: string;
  file_size?: number;
};

export type TelegramFile = {
  file_id: string;
  file_unique_id: string;
  file_size?: number;
  file_path?: string;
};

export type TelegramMessage = {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  text?: string;
  voice?: TelegramVoice;
  audio?: TelegramAudio;
  date: number;
};

export type TelegramCallbackQuery = {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  data?: string;
};

export type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
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
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw new Error(`Telegram API ${method}: network error: ${(err as Error).message}`);
  }
  let data: TelegramApiResponse<T>;
  try {
    data = (await res.json()) as TelegramApiResponse<T>;
  } catch {
    throw new Error(`Telegram API ${method}: non-JSON response (HTTP ${res.status})`);
  }
  if (!data.ok) throw new Error(`Telegram API ${method}: ${data.description}`);
  return data.result;
}

// --- File download ---

/**
 * Fetch the bytes of an uploaded Telegram file.
 *
 * Telegram serves uploaded media through a two-step flow: first `getFile`
 * returns a relative `file_path`, then the bytes are fetched from the
 * file host. Both steps share the bot token.
 */
export async function downloadTelegramFile(
  token: string,
  fileId: string,
): Promise<{ bytes: Uint8Array; mimeType?: string; filePath: string }> {
  const file = await callTelegramApi<TelegramFile>(token, "getFile", {
    file_id: fileId,
  });
  if (!file.file_path) {
    throw new Error(`Telegram getFile returned no file_path for ${fileId}`);
  }
  const url = `${TELEGRAM_API}/file/bot${token}/${file.file_path}`;
  let res: Response;
  try {
    res = await fetch(url);
  } catch (err) {
    throw new Error(`Telegram file download network error: ${(err as Error).message}`);
  }
  if (!res.ok) {
    throw new Error(`Telegram file download failed: HTTP ${res.status}`);
  }
  const buffer = await res.arrayBuffer();
  return {
    bytes: new Uint8Array(buffer),
    mimeType: res.headers.get("content-type") ?? undefined,
    filePath: file.file_path,
  };
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
    let lastError: Error | null = null;
    for (const chunk of chunks) {
      try {
        await callTelegramApi(this.token, "sendMessage", {
          chat_id: this.chatId,
          text: chunk,
        });
      } catch (err) {
        lastError = err as Error;
      }
    }
    if (lastError) throw lastError;
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
