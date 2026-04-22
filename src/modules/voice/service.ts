/**
 * Voice service boundary — resolves STT and TTS providers from the core
 * provider registry and applies preflight validation. Callers at the
 * daemon control API (and any other client surface) go through these
 * functions instead of touching providers directly.
 */

import { getProviderRegistry } from "#core/modules/provider-registry.js";
import { transcribeAudio } from "#modules/transcription/service.js";
import {
  SPEECH_SYNTHESIS_PROVIDER_TYPE,
  type SpeechAudioResult,
  SpeechSynthesisFormatError,
  type SpeechSynthesisInput,
  type SpeechSynthesisProvider,
  SpeechSynthesisProviderUnavailableError,
  type VoiceInput,
  type VoiceTranscript,
} from "./types.js";

export function getSpeechSynthesisProvider(): SpeechSynthesisProvider {
  const registry = getProviderRegistry();
  const provider = registry?.get<SpeechSynthesisProvider>(SPEECH_SYNTHESIS_PROVIDER_TYPE) ?? null;
  if (!provider) {
    throw new SpeechSynthesisProviderUnavailableError();
  }
  return provider;
}

/**
 * Transcribe voice audio to text. Reuses the `transcription` protocol so
 * the same registered provider (e.g. `transcription-whisper`) serves both
 * channel ingestion and voice-module clients.
 */
export async function transcribeVoice(input: VoiceInput): Promise<VoiceTranscript> {
  return transcribeAudio(input);
}

/**
 * Synthesize speech audio from text. Validates preconditions against the
 * active provider's declared format support; unsupported formats fail
 * loudly before the request reaches the vendor.
 */
export async function synthesizeSpeech(input: SpeechSynthesisInput): Promise<SpeechAudioResult> {
  if (!input.text.trim()) {
    throw new Error("synthesizeSpeech: text is empty");
  }
  const provider = getSpeechSynthesisProvider();
  if (input.format && !provider.supportedFormats.includes(input.format)) {
    throw new SpeechSynthesisFormatError(input.format, provider.supportedFormats);
  }
  return provider.synthesize(input);
}
