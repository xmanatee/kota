/**
 * Local-side handler for the `voice` namespace.
 *
 * Voice transcription and synthesis depend on STT/TTS providers and their
 * upstream credentials, both of which live on the daemon side (registered
 * in `onLoad`, which is skipped on the CLI's `"commands"` lifecycle path).
 * The local handler therefore surfaces `daemon_required` so the CLI renders a single
 * clear "start the daemon" hint instead of trying to load and configure
 * providers in the operator's process.
 */
import type {
  VoiceClient,
  VoiceSynthesizeResult,
  VoiceTranscribeResult,
} from "#core/server/kota-client.js";

export function localVoiceClient(): VoiceClient {
  return {
    async transcribe(): Promise<VoiceTranscribeResult> {
      return { ok: false, reason: "daemon_required" };
    },
    async synthesize(): Promise<VoiceSynthesizeResult> {
      return { ok: false, reason: "daemon_required" };
    },
  };
}
