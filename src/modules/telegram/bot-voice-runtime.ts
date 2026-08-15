import {
  TranscriptionProviderUnavailableError,
  transcribeAudio,
} from "#modules/transcription/index.js";
import type { TelegramProjectTarget } from "./bot-runtime-types.js";
import { TelegramSessionRuntime } from "./bot-session-runtime.js";
import type {
  TelegramAudio,
  TelegramMessage,
  TelegramVoice,
} from "./client.js";
import { downloadTelegramFile } from "./client.js";

export abstract class TelegramVoiceRuntime extends TelegramSessionRuntime {
  protected async handleVoiceMessage(message: TelegramMessage): Promise<void> {
    const chatId = message.chat.id;
    const interactiveAllowed = this.isInteractiveChatAllowed(chatId);
    if (!interactiveAllowed && !this.options.inboundSignals) {
      this.sendUnauthorizedChatMessage(chatId);
      return;
    }
    const resolved = await this.resolveProjectTarget(chatId);
    if (!resolved.ok) {
      if (interactiveAllowed) this.sendText(chatId, resolved.message);
      else this.sendUnauthorizedChatMessage(chatId);
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
      if (interactiveAllowed) {
        this.sendText(chatId, `Couldn't download your voice message: ${(err as Error).message}`);
      } else {
        this.sendUnauthorizedChatMessage(chatId);
      }
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
        if (interactiveAllowed) {
          this.sendText(
            chatId,
            "Voice transcription isn't configured on this KOTA deployment. Please send your message as text.",
          );
        } else {
          this.sendUnauthorizedChatMessage(chatId);
        }
        return;
      }
      if (interactiveAllowed) {
        this.sendText(chatId, `Voice transcription failed: ${(err as Error).message}`);
      } else {
        this.sendUnauthorizedChatMessage(chatId);
      }
      return;
    }

    if (!transcript) {
      if (interactiveAllowed) {
        this.sendText(chatId, "I couldn't hear anything in that voice message. Please try again.");
      } else {
        this.sendUnauthorizedChatMessage(chatId);
      }
      return;
    }

    if (interactiveAllowed) this.sendText(chatId, `\u{1F3A4} Transcribed: ${transcript}`);
    let admittedTarget: TelegramProjectTarget;
    try {
      admittedTarget = this.admitProjectTarget(resolved.target);
    } catch (err) {
      if (interactiveAllowed) this.sendText(chatId, (err as Error).message);
      else this.sendUnauthorizedChatMessage(chatId);
      return;
    }
    if (this.emitVoiceTranscriptInboundSignal(admittedTarget, message, transcript)) return;
    if (!interactiveAllowed) {
      this.sendUnauthorizedChatMessage(chatId);
      return;
    }
    await this.handleMessage(chatId, transcript, message.chat.first_name, admittedTarget);
  }

  protected abstract isInteractiveChatAllowed(chatId: number): boolean;
  protected abstract sendUnauthorizedChatMessage(chatId: number): void;
  protected abstract emitVoiceTranscriptInboundSignal(
    target: TelegramProjectTarget,
    sourceMessage: TelegramMessage,
    transcript: string,
  ): boolean;
  protected abstract handleMessage(
    chatId: number,
    text: string,
    firstName?: string,
    resolvedTarget?: TelegramProjectTarget,
    sourceMessage?: TelegramMessage,
  ): Promise<void>;
}
