import { printTerminalDiagnostic } from "#core/modules/terminal-renderer.js";
import type { TelegramScopeTarget, TelegramScopeTargetResolution } from "./bot-runtime-types.js";
import { TelegramVoiceRuntime } from "./bot-voice-runtime.js";
import type { TelegramMessage, TelegramUpdate } from "./client.js";
import {
  emitTelegramMessageInboundSignal,
  emitTelegramUpdateInboundSignal,
  emitTelegramVoiceTranscriptInboundSignal,
  type TelegramInboundSignalConfig,
} from "./inbound-signal.js";

export class TelegramMessageRuntime extends TelegramVoiceRuntime {
  protected isInteractiveChatAllowed(chatId: number): boolean {
    return !(
      this.options.allowedChatIds?.length &&
      !this.options.allowedChatIds.includes(chatId)
    );
  }

  protected sendUnauthorizedChatMessage(chatId: number): void {
    this.sendText(chatId, "Sorry, I'm not authorized to chat with you.");
  }

  protected async handleMessage(
    chatId: number,
    text: string,
    firstName?: string,
    resolvedTarget?: TelegramScopeTarget,
    sourceMessage?: TelegramMessage,
  ): Promise<void> {
    const interactiveAllowed = this.isInteractiveChatAllowed(chatId);

    if (text === "/scope" || text.startsWith("/scope ")) {
      if (!interactiveAllowed) {
        this.sendUnauthorizedChatMessage(chatId);
        return;
      }
      try {
        await this.handleScopeCommand(chatId, text);
      } catch (err) {
        printTerminalDiagnostic(
          `[kota-telegram] Scope switch error in chat ${chatId}:`,
          "error",
          (err as Error).message,
        );
        this.sendText(chatId, "Scope selection failed.");
      }
      return;
    }

    if (!interactiveAllowed && (!this.options.inboundSignals || !sourceMessage)) {
      this.sendUnauthorizedChatMessage(chatId);
      return;
    }

    let resolved: TelegramScopeTargetResolution;
    try {
      resolved = resolvedTarget
        ? { ok: true, target: resolvedTarget }
        : await this.resolveScopeTarget(chatId);
    } catch (err) {
      printTerminalDiagnostic(
        `[kota-telegram] Scope resolution error in chat ${chatId}:`,
        "error",
        (err as Error).message,
      );
      if (interactiveAllowed) this.sendText(chatId, "Scope selection failed.");
      else this.sendUnauthorizedChatMessage(chatId);
      return;
    }

    if (text === "/start") {
      if (!interactiveAllowed) {
        this.sendUnauthorizedChatMessage(chatId);
        return;
      }
      if (!resolved.ok) {
        this.sendText(chatId, resolved.message);
        return;
      }
      this.sendText(
        chatId,
        `Hi ${firstName ?? "there"}! I'm KOTA. Send me any message.\n\n` +
          `/clear — New conversation\n/status — Session info`,
      );
      return;
    }

    if (text === "/clear") {
      if (!interactiveAllowed) {
        this.sendUnauthorizedChatMessage(chatId);
        return;
      }
      if (!resolved.ok) {
        this.sendText(chatId, resolved.message);
        return;
      }
      const session = this.sessions.get(resolved.target.sessionKey);
      if (session) {
        await session.agent.close();
        this.sessions.delete(resolved.target.sessionKey);
      }
      this.sendText(chatId, "Conversation cleared.");
      return;
    }

    if (text === "/status") {
      if (!interactiveAllowed) {
        this.sendUnauthorizedChatMessage(chatId);
        return;
      }
      if (!resolved.ok) {
        this.sendText(chatId, resolved.message);
        return;
      }
      const session = this.sessions.get(resolved.target.sessionKey);
      const busy = this.busyChats.has(resolved.target.sessionKey);
      const pendingCount = resolved.target.scopeRuntime.scheduler.count();
      const statusParts = [
        session
          ? `Active session (${busy ? "processing" : "idle"}). Cost: ${session.agent.getCostSummary()}`
          : "No active session. Send a message to start one.",
      ];
      if (pendingCount > 0) statusParts.push(`${pendingCount} pending reminder(s)`);
      this.sendText(chatId, statusParts.join("\n"));
      return;
    }

    if (!resolved.ok) {
      if (interactiveAllowed) this.sendText(chatId, resolved.message);
      else this.sendUnauthorizedChatMessage(chatId);
      return;
    }
    if (this.emitInboundSignal(resolved.target, sourceMessage)) return;
    if (!interactiveAllowed) {
      this.sendUnauthorizedChatMessage(chatId);
      return;
    }
    if (text.startsWith("/")) return;
    try {
      await this.processMessage(resolved.target, text, firstName);
    } catch (err) {
      printTerminalDiagnostic(
        `[kota-telegram] Error in chat ${chatId}:`,
        "error",
        (err as Error).message,
      );
      this.sendText(chatId, "Something went wrong. Try again or /clear to start over.");
    }
  }

  private emitInboundSignal(
    target: TelegramScopeTarget,
    sourceMessage: TelegramMessage | undefined,
  ): boolean {
    const inboundSignals = this.options.inboundSignals;
    if (!inboundSignals || !sourceMessage) return false;
    const result = emitTelegramMessageInboundSignal(
      inboundSignals.events,
      sourceMessage,
      this.inboundSignalContext(target, inboundSignals.config),
    );
    if (result.emitted) return result.consumed;
    if ("error" in result) {
      throw new Error(`Telegram inbound signal is invalid: ${result.error}`);
    }
    return false;
  }

  protected emitVoiceTranscriptInboundSignal(
    target: TelegramScopeTarget,
    sourceMessage: TelegramMessage,
    transcript: string,
  ): boolean {
    const inboundSignals = this.options.inboundSignals;
    if (!inboundSignals) return false;
    const result = emitTelegramVoiceTranscriptInboundSignal(
      inboundSignals.events,
      sourceMessage,
      transcript,
      this.inboundSignalContext(target, inboundSignals.config),
    );
    if (result.emitted) return result.consumed;
    if ("error" in result) {
      throw new Error(`Telegram inbound signal is invalid: ${result.error}`);
    }
    return false;
  }

  protected async emitInboundSignalUpdate(update: TelegramUpdate): Promise<boolean> {
    const inboundSignals = this.options.inboundSignals;
    if (!inboundSignals) return false;
    const chatId = telegramUpdateChatId(update);
    if (chatId === null) return false;
    const resolved = await this.resolveScopeTarget(chatId);
    if (!resolved.ok) return false;
    const result = emitTelegramUpdateInboundSignal(
      inboundSignals.events,
      update,
      this.inboundSignalContext(resolved.target, inboundSignals.config),
    );
    if (result.emitted) return result.consumed;
    if ("error" in result) {
      throw new Error(`Telegram inbound signal is invalid: ${result.error}`);
    }
    return false;
  }

  private inboundSignalContext(
    target: TelegramScopeTarget,
    config: TelegramInboundSignalConfig,
  ) {
    return {
      scopeId: target.scopeId,
      receivedAt: new Date().toISOString(),
      config,
      allowedChatIds: this.options.allowedChatIds,
    };
  }
}

function telegramUpdateChatId(update: TelegramUpdate): number | null {
  if (update.message) return update.message.chat.id;
  if (update.edited_message) return update.edited_message.chat.id;
  if (update.callback_query?.message) return update.callback_query.message.chat.id;
  if (update.message_reaction) return update.message_reaction.chat.id;
  if (update.my_chat_member) return update.my_chat_member.chat.id;
  if (update.chat_member) return update.chat_member.chat.id;
  return null;
}
