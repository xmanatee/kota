/**
 * Voice namespace client contract.
 *
 * The voice module owns its KotaClient namespace surface end-to-end: this
 * file declares the transcribe/synthesize options and result types and the
 * `VoiceClient` interface that the `KotaClient` aggregate composes. Both the
 * local-side handler (`localVoiceClient` in `voice-operations.ts`) and the
 * daemon-side handler (`daemonClient(link)` in `index.ts`) realize this
 * contract; the `kota voice` CLI subcommands consume it through
 * `ctx.client.voice` or by importing these types from
 * `#modules/voice/client.js`.
 *
 * The three-arm result shape (`{ ok: true; ... } | { ok: false; reason:
 * "daemon_required" } | { ok: false; reason: "transport_error"; ... }`) is
 * the namespace contract. Only the local handler emits the
 * `daemon_required` arm; the daemon-side factory never returns it.
 */

export type VoiceTranscribeOptions = {
  audio: Uint8Array;
  mimeType: string;
  filename?: string;
  languageHint?: string;
};

export type VoiceTranscribeResult =
  | { ok: true; text: string; language?: string }
  | { ok: false; reason: "daemon_required" }
  | {
      ok: false;
      reason: "transport_error";
      status: number;
      message: string;
      code?: string;
    };

export type VoiceSynthesizeOptions = {
  text: string;
  voice?: string;
  languageHint?: string;
  format?: string;
};

export type VoiceSynthesizeResult =
  | { ok: true; audio: Buffer; mimeType: string; format: string }
  | { ok: false; reason: "daemon_required" }
  | {
      ok: false;
      reason: "transport_error";
      status: number;
      message: string;
      code?: string;
    };

/**
 * Voice operations.
 *
 * `transcribe` and `synthesize` consume the daemon's STT and TTS providers,
 * which own the upstream credentials and provider client. Local mode (no
 * daemon reachable) surfaces `daemon_required` so the CLI can render a
 * single clear "start the daemon" hint instead of trying to load and
 * configure providers in the operator process.
 */
export interface VoiceClient {
  transcribe(options: VoiceTranscribeOptions): Promise<VoiceTranscribeResult>;
  synthesize(options: VoiceSynthesizeOptions): Promise<VoiceSynthesizeResult>;
}
