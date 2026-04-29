import { getProviderRegistry } from "#core/modules/provider-registry.js";
import {
  TRANSCRIPTION_PROVIDER_TYPE,
  type TranscriptionInput,
  type TranscriptionProvider,
  TranscriptionProviderUnavailableError,
  type TranscriptionResult,
} from "./types.js";

/**
 * Resolve the active transcription provider, or throw an explicit
 * unavailable error. Caller-owned error handling keeps the failure mode
 * visible at each call site.
 */
export function getTranscriptionProvider(): TranscriptionProvider {
  const registry = getProviderRegistry();
  const provider = registry?.get(TRANSCRIPTION_PROVIDER_TYPE) ?? null;
  if (!provider) {
    throw new TranscriptionProviderUnavailableError();
  }
  return provider;
}

/**
 * Transcribe audio via the active provider. Wraps provider errors in a
 * consistent shape so callers can render a single user-facing failure.
 */
export async function transcribeAudio(
  input: TranscriptionInput,
): Promise<TranscriptionResult> {
  const provider = getTranscriptionProvider();
  return provider.transcribe(input);
}
