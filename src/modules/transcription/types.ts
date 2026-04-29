/**
 * Transcription provider protocol — audio → text.
 *
 * Channels that receive voice messages route them through the active
 * provider registered under the `TRANSCRIPTION_PROVIDER_TYPE` token.
 * Absence of a provider is an explicit, typed error; channels surface that
 * failure to the user instead of silently dropping the audio.
 */

import {
  defineProviderToken,
  type ProviderToken,
} from "#core/modules/provider-token.js";

export type TranscriptionInput = {
  /** Raw audio bytes. */
  audio: Uint8Array;
  /** IETF mime type (e.g. "audio/ogg", "audio/mp4", "audio/mpeg"). */
  mimeType: string;
  /** Optional original filename — some providers use it as a format hint. */
  filename?: string;
  /** Optional BCP-47 language hint (e.g. "en", "en-US"). */
  languageHint?: string;
};

export type TranscriptionResult = {
  /** Recognized text. */
  text: string;
  /** Detected or provided language (BCP-47), when the provider reports one. */
  language?: string;
};

export interface TranscriptionProvider {
  /** Provider name — matches the name used in ProviderRegistry.register. */
  readonly name: string;
  transcribe(input: TranscriptionInput): Promise<TranscriptionResult>;
}

export class TranscriptionProviderUnavailableError extends Error {
  constructor(message = "No transcription provider is registered") {
    super(message);
    this.name = "TranscriptionProviderUnavailableError";
  }
}

export const TRANSCRIPTION_PROVIDER_TYPE: ProviderToken<TranscriptionProvider> =
  defineProviderToken<TranscriptionProvider>("transcription");
