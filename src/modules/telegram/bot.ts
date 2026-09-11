/** Telegram Bot adapter — HTTP polling plus one scoped session per chat. */

import type { ScopeRuntime } from "#core/daemon/scope-runtime.js";
import { printTerminalDiagnostic } from "#core/modules/terminal-renderer.js";
import { redactOutboundHttpText } from "#core/outbound-http/index.js";
import { hostActiveClock } from "#core/workflow/host-suspension.js";
import { TelegramMessageRuntime } from "./bot-message-runtime.js";
import {
  callTelegramApi,
  ERROR_BACKOFF_MS,
  isRetryableTelegramApiFailure,
  isTelegramAuthenticationFailure,
  isTelegramGetUpdatesConflict,
  POLL_REQUEST_TIMEOUT_MS,
  POLL_TIMEOUT_S,
  splitMessage,
  TelegramApiError,
  TelegramApiTransportError,
  TelegramTransport,
  type TelegramUpdate,
  type TelegramUser,
} from "./client.js";
import { TELEGRAM_SIGNAL_ALLOWED_UPDATES } from "./inbound-signal.js";
import { acquireTelegramPollingOwner } from "./polling-ownership.js";

export type { TelegramBotOptions } from "./bot-runtime-types.js";
export { callTelegramApi, splitMessage, TelegramTransport };

export class TelegramGetUpdatesConflictError extends Error {
  constructor() {
    super(
      "Telegram getUpdates conflict: another Telegram Bot API getUpdates consumer is already using this bot token. Stop the other KOTA or Telegram process before enabling telegram-interactive.",
    );
    this.name = "TelegramGetUpdatesConflictError";
  }
}

export class TelegramBot extends TelegramMessageRuntime {
  private running = false;
  private offset = 0;
  private pollController: AbortController | null = null;
  private releasePollingOwner: (() => void) | null = null;
  private pollHealthy = false;

  async start(): Promise<void> {
    const releasePollingOwner = acquireTelegramPollingOwner(
      this.token,
      this.options.pollOwner ?? {
        owner: "telegram-interactive",
        source: "TelegramBot.start",
      },
    );
    this.releasePollingOwner = releasePollingOwner;
    this.running = true;
    this.pollHealthy = false;
    try {
      let me: TelegramUser | null = null;
      while (this.running && me === null) {
        const started = hostActiveClock.observe();
        const controller = new AbortController();
        this.pollController = controller;
        try {
          me = await callTelegramApi<TelegramUser>(
            this.token,
            "getMe",
            undefined,
            { http: this.options.http, signal: controller.signal },
          );
        } catch (error) {
          if (!this.running) break;
          if (!isRetryableTelegramApiFailure(error)) throw error;
          this.reportRetry(error, "startup", started);
          await sleep(ERROR_BACKOFF_MS);
        } finally {
          if (this.pollController === controller) this.pollController = null;
        }
      }
      if (me === null) return;
      printTerminalDiagnostic(`[kota-telegram] Bot: @${me.username ?? me.first_name}`);
      printTerminalDiagnostic("[kota-telegram] Listening for messages...");

      while (this.running) {
        try {
          await this.poll();
        } catch (err) {
          if (!this.running) break;
          if (isTelegramGetUpdatesConflict(err)) {
            this.running = false;
            throw new TelegramGetUpdatesConflictError();
          }
          // Handler failures are distinct from a failed getUpdates request.
          const pollFailed = (err instanceof TelegramApiError || err instanceof TelegramApiTransportError) &&
            err.method === "getUpdates";
          if (pollFailed && isTelegramAuthenticationFailure(err)) throw err;
          if (!pollFailed) {
            printTerminalDiagnostic("[kota-telegram] Update handler error:", "error", this.safeError(err));
          }
          await sleep(ERROR_BACKOFF_MS);
        }
      }
    } finally {
      this.running = false;
      if (this.releasePollingOwner === releasePollingOwner) {
        this.releasePollingOwner = null;
      }
      releasePollingOwner();
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    this.pollController?.abort();
    this.pollController = null;
    const cleanups = [...this.sessions.values()].map((session) => session.agent.close());
    this.sessions.clear();
    await Promise.all(cleanups);
  }

  get sessionCount(): number {
    return this.sessions.size;
  }

  setDefaultScopeRuntime(runtime: ScopeRuntime): void {
    this.options.defaultScopeRuntime = runtime;
  }

  listScopeSessionIds(scopeId: string): string[] {
    return [...this.sessions.entries()]
      .filter(([, session]) => session.identity.meta?.scopeId === scopeId)
      .map(([sessionKey]) => `telegram:${sessionKey}`);
  }

  async closeScopeSessions(scopeId: string): Promise<void> {
    const cleanups: Promise<void>[] = [];
    for (const [key, session] of this.sessions) {
      if (session.identity.meta?.scopeId !== scopeId) continue;
      cleanups.push(Promise.resolve(session.agent.close()));
      this.sessions.delete(key);
      this.busyChats.delete(key);
    }
    await Promise.all(cleanups);
  }

  /** Send a message to active chat sessions, optionally scoped to one scope. */
  broadcastToChats(text: string, scopeId?: string): void {
    for (const [key, session] of this.sessions) {
      const value = session.identity.meta?.scopeId;
      const sessionScopeId = typeof value === "string" ? value : "";
      if (scopeId !== undefined && sessionScopeId !== scopeId) continue;
      const chatId = Number.parseInt(key.split(":")[0]!, 10);
      if (Number.isFinite(chatId)) this.sendText(chatId, text);
    }
  }

  private safeError(error: unknown): string {
    return redactOutboundHttpText(
      (error instanceof Error ? error.message : String(error)).replaceAll(this.token, "[redacted]"),
    );
  }

  private reportRetry(
    error: unknown,
    phase: "startup" | "poll",
    started: ReturnType<typeof hostActiveClock.observe>,
  ): void {
    this.pollHealthy = false;
    const finished = hostActiveClock.observe();
    // A long request alone is not evidence of sleep; consult the OS clock owner.
    const hostSuspendedMs = error instanceof TelegramApiTransportError &&
      error.statusCode === undefined && finished.wallMs - started.wallMs > 5_000
      ? hostActiveClock.suspendedBetween(started, finished) : 0;
    const message = `telegram-interactive ${phase} retrying after ${
      isRetryableTelegramApiFailure(error) ? "transient network/provider failure: " : ""
    }${this.safeError(error)}`;
    if (this.options.onOperationHealth) {
      this.options.onOperationHealth({ status: "failed", message, phase, hostSuspendedMs });
    } else {
      printTerminalDiagnostic("[kota-telegram]", "error", message);
    }
  }

  private async poll(): Promise<void> {
    const controller = new AbortController();
    this.pollController = controller;
    const started = hostActiveClock.observe();
    const updates = await callTelegramApi<TelegramUpdate[]>(this.token, "getUpdates", {
      offset: this.offset,
      timeout: POLL_TIMEOUT_S,
      allowed_updates: [...TELEGRAM_SIGNAL_ALLOWED_UPDATES],
    }, {
      signal: controller.signal,
      http: this.options.http,
      timeoutMs: POLL_REQUEST_TIMEOUT_MS,
    }).catch((error: unknown) => {
      if (this.running && !isTelegramGetUpdatesConflict(error) &&
          !isTelegramAuthenticationFailure(error)) {
        this.reportRetry(error, "poll", started);
      }
      throw error;
    }).finally(() => {
      if (this.pollController === controller) this.pollController = null;
    });
    if (!this.running) return;
    if (!this.pollHealthy) {
      this.pollHealthy = true;
      this.options.onOperationHealth?.({ status: "healthy" });
    }

    for (const update of updates) {
      this.offset = update.update_id + 1;
      if (update.callback_query) {
        const callbackChatId = update.callback_query.message?.chat.id;
        if (
          callbackChatId === undefined ||
          !this.isInteractiveChatAllowed(callbackChatId)
        ) {
          continue;
        }
        let handled = false;
        if (this.options.onCallbackQuery) {
          try {
            handled = await this.options.onCallbackQuery(update.callback_query);
          } catch (err) {
            printTerminalDiagnostic(
              "[kota-telegram] Callback handler error:",
              "error",
              (err as Error).message,
            );
          }
        }
        if (!handled) await this.emitInboundSignalUpdate(update);
        continue;
      }
      if (update.edited_message || update.message_reaction || update.my_chat_member || update.chat_member) {
        await this.emitInboundSignalUpdate(update);
        continue;
      }
      const message = update.message;
      if (!message) continue;
      const text = message.text ?? message.caption;
      if (text !== undefined) {
        const chatId = message.chat.id;
        const firstName = message.chat.first_name;
        if (this.options.onStatusCommand) {
          const handled = await this.options.onStatusCommand(chatId, text);
          if (handled) continue;
        }
        const replyToId = message.reply_to_message?.message_id;
        if (replyToId !== undefined && this.options.onChatReply) {
          try {
            const handled = await this.options.onChatReply(chatId, replyToId, text);
            if (!handled) await this.handleMessage(chatId, text, firstName, undefined, message);
          } catch (err) {
            printTerminalDiagnostic(
              `[kota-telegram] Chat-reply handler error in chat ${chatId}:`,
              "error",
              (err as Error).message,
            );
            await this.handleMessage(chatId, text, firstName, undefined, message);
          }
          continue;
        }
        await this.handleMessage(chatId, text, firstName, undefined, message);
        continue;
      }
      if (message.voice || message.audio) {
        void this.handleVoiceMessage(message).catch((err) => {
          printTerminalDiagnostic(
            `[kota-telegram] Voice handling error in chat ${message.chat.id}:`,
            "error",
            (err as Error).message,
          );
        });
      }
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
