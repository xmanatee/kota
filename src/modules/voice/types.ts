/**
 * Voice protocols — speech-to-text (STT) input and text-to-speech (TTS)
 * output. Both sides live behind the core provider registry so clients
 * reach voice through the daemon instead of talking to vendors directly.
 *
 * STT reuses the `TranscriptionProvider` protocol from the transcription
 * module. TTS introduces a `SpeechSynthesisProvider` protocol registered
 * under the `SPEECH_SYNTHESIS_PROVIDER_TYPE` token.
 *
 * Both sides surface absence with typed errors so callers can render a
 * single user-facing failure at each client surface.
 */

import {
  defineProviderToken,
  type ProviderToken,
} from "#core/modules/provider-token.js";

export {
  TRANSCRIPTION_PROVIDER_TYPE as STT_PROVIDER_TYPE,
  type TranscriptionInput as VoiceInput,
  type TranscriptionProvider as SpeechToTextProvider,
  TranscriptionProviderUnavailableError as SpeechToTextProviderUnavailableError,
  type TranscriptionResult as VoiceTranscript,
} from "#modules/transcription/types.js";

/** Request to synthesize speech from a text prompt. */
export type SpeechSynthesisInput = {
  /** Text to speak. Must be non-empty after trim(). */
  text: string;
  /** Optional voice identifier. Providers interpret this against their own catalog. */
  voice?: string;
  /** Optional BCP-47 language hint (e.g. "en", "en-US"). */
  languageHint?: string;
  /** Output audio format. Providers that do not support the requested format fail loudly. */
  format?: SpeechAudioFormat;
};

/** Audio format for synthesized speech. Extend only when a provider needs a new wire format. */
export type SpeechAudioFormat = "mp3" | "wav" | "ogg" | "opus" | "aac" | "flac" | "pcm";

export type SpeechAudioResult = {
  /** Raw audio bytes. */
  audio: Uint8Array;
  /** IETF mime type matching the emitted bytes (e.g. "audio/mpeg" for mp3). */
  mimeType: string;
  /** Echo of the emitted format so callers can dispatch without sniffing mime. */
  format: SpeechAudioFormat;
};

export interface SpeechSynthesisProvider {
  /** Provider name — matches the name used in ProviderRegistry.register. */
  readonly name: string;
  /** Formats this provider can emit; used for preflight validation. */
  readonly supportedFormats: readonly SpeechAudioFormat[];
  synthesize(input: SpeechSynthesisInput): Promise<SpeechAudioResult>;
}

export class SpeechSynthesisProviderUnavailableError extends Error {
  constructor(message = "No speech-synthesis provider is registered") {
    super(message);
    this.name = "SpeechSynthesisProviderUnavailableError";
  }
}

export class SpeechSynthesisFormatError extends Error {
  readonly requested: SpeechAudioFormat;
  readonly supported: readonly SpeechAudioFormat[];
  constructor(requested: SpeechAudioFormat, supported: readonly SpeechAudioFormat[]) {
    super(
      `Speech-synthesis provider does not support format "${requested}". ` +
        `Supported: ${supported.join(", ") || "(none declared)"}`,
    );
    this.name = "SpeechSynthesisFormatError";
    this.requested = requested;
    this.supported = supported;
  }
}

export const SPEECH_SYNTHESIS_PROVIDER_TYPE: ProviderToken<SpeechSynthesisProvider> =
  defineProviderToken<SpeechSynthesisProvider>("speech-synthesis");
