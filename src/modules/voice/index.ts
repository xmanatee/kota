/**
 * Voice module — end-to-end speech I/O boundary for KOTA clients.
 *
 * Exposes the STT and TTS protocols and the resolver service used by the
 * daemon control API. Reuses the existing `transcription` protocol on the
 * STT side; introduces the `SpeechSynthesisProvider` protocol on the TTS
 * side. No providers ship here — absence is an explicit, typed error so
 * clients can surface a single clear failure at each surface.
 */

import type { KotaModule } from "#core/modules/module-types.js";
import type { DaemonTransport } from "#core/server/daemon-transport.js";
import { buildVoiceCommand } from "./cli.js";
import type {
  VoiceClient,
  VoiceSynthesizeOptions,
  VoiceSynthesizeResult,
  VoiceTranscribeOptions,
  VoiceTranscribeResult,
} from "./client.js";
import { voiceControlRoutes, voiceRoutes } from "./routes.js";
import { localVoiceClient } from "./voice-operations.js";

export {
  applyRealtimeVoiceSessionEvent,
  createRealtimeVoiceProviderFailedEvent,
  createRealtimeVoiceProviderUnavailableEvent,
  createRealtimeVoiceSessionState,
  createRealtimeVoiceTerminalErrorEvent,
  DEFAULT_REALTIME_VOICE_SESSION_CONFIG,
  type RealtimeVoiceAssistantAudioChunkEvent,
  type RealtimeVoiceAssistantTextEvent,
  type RealtimeVoiceAudioChunk,
  type RealtimeVoiceChannelIdentity,
  type RealtimeVoiceCompletionEvent,
  type RealtimeVoiceFinalTranscriptEvent,
  type RealtimeVoiceInputAudioChunkEvent,
  type RealtimeVoiceInterruptionEvent,
  type RealtimeVoicePartialTranscriptEvent,
  type RealtimeVoiceSessionActiveState,
  type RealtimeVoiceSessionCompletedState,
  type RealtimeVoiceSessionConfig,
  type RealtimeVoiceSessionErroredState,
  type RealtimeVoiceSessionEvent,
  type RealtimeVoiceSessionNotStartedState,
  type RealtimeVoiceSessionStartedEvent,
  type RealtimeVoiceSessionState,
  RealtimeVoiceSessionTransitionError,
  type RealtimeVoiceTerminalErrorCode,
  type RealtimeVoiceTerminalErrorEvent,
  type RealtimeVoiceTurnPhase,
} from "./realtime-session.js";
export {
  getSpeechSynthesisProvider,
  synthesizeSpeech,
  transcribeVoice,
} from "./service.js";
export {
  SPEECH_SYNTHESIS_PROVIDER_TYPE,
  type SpeechAudioFormat,
  type SpeechAudioResult,
  SpeechSynthesisFormatError,
  type SpeechSynthesisInput,
  type SpeechSynthesisProvider,
  SpeechSynthesisProviderUnavailableError,
  type SpeechToTextProvider,
  SpeechToTextProviderUnavailableError,
  STT_PROVIDER_TYPE,
  type VoiceInput,
  type VoiceTranscript,
} from "./types.js";

const voiceModule: KotaModule = {
  name: "voice",
  version: "1.0.0",
  description: "Voice I/O boundary: STT input and TTS output for every KOTA client",
  dependencies: ["transcription"],
  commands: (ctx) => [buildVoiceCommand(ctx)],
  routes: () => voiceRoutes(),
  controlRoutes: () => voiceControlRoutes(),
  localClient: () => ({ voice: localVoiceClient() }),
  daemonClient: (link) => ({ voice: buildVoiceDaemonHandler(link) }),
};

/**
 * Wire shapes the `/voice/transcribe` and `/voice/synthesize` routes return
 * in `routes.ts`. The success and error envelopes are unioned per route so
 * the boundary cast stays typed: a single decoder per response feeds the
 * three-arm namespace contract without reaching for `Record<string,
 * unknown>` at the JSON parse seam.
 */
type VoiceTranscribeWireBody = {
  text?: string;
  language?: string;
  error?: string;
  code?: string;
};

type VoiceSynthesizeWireBody = {
  audioBase64?: string;
  mimeType?: string;
  format?: string;
  error?: string;
  code?: string;
};

/**
 * Daemon-side `VoiceClient` backed by the typed `DaemonTransport`. Calls the
 * `/voice/transcribe` and `/voice/synthesize` POST routes the voice module
 * registers through `voiceControlRoutes`. The wire shape matches the route's
 * existing JSON contract: the audio payload travels base64-encoded inside
 * an `audioBase64` JSON field in both directions, validating that the typed
 * `DaemonTransport` link cleanly threads JSON-serializable wire
 * transformations of binary payloads through `fetchRaw` when the wire shape
 * matches the route's JSON contract.
 *
 * `transcribe(options)` re-encodes the input `Uint8Array` to a base64
 * string, posts the JSON body, and decodes the success arm back to the
 * namespace contract or collapses the daemon's `400`/`502`/`503` envelopes
 * into the uniform `transport_error` shape with the optional provider error
 * `code` propagated verbatim.
 *
 * `synthesize(options)` posts the text/voice/language/format JSON body,
 * decodes `audioBase64` back to a Node `Buffer` for the success arm, and
 * collapses the daemon's `400`/`502`/`503` envelopes into the same
 * `transport_error` shape with the provider error `code` (e.g.
 * `tts-format-unsupported`, `tts-unavailable`, `tts-failed`) propagated
 * verbatim.
 *
 * The factory never returns the `daemon_required` arm; only the local
 * handler emits that arm when no daemon is reachable.
 */
function buildVoiceDaemonHandler(link: DaemonTransport): VoiceClient {
  return {
    transcribe: async (
      options: VoiceTranscribeOptions,
    ): Promise<VoiceTranscribeResult> => {
      const body = {
        audioBase64: Buffer.from(options.audio).toString("base64"),
        mimeType: options.mimeType,
        ...(options.filename !== undefined && { filename: options.filename }),
        ...(options.languageHint !== undefined && {
          languageHint: options.languageHint,
        }),
      };
      const res = await link.fetchRaw("/voice/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const parsed = (await res.json()) as VoiceTranscribeWireBody;
      if (!res.ok) {
        return {
          ok: false,
          reason: "transport_error",
          status: res.status,
          message: parsed.error ?? "",
          ...(parsed.code !== undefined && { code: parsed.code }),
        };
      }
      return {
        ok: true,
        text: parsed.text ?? "",
        ...(parsed.language !== undefined && { language: parsed.language }),
      };
    },
    synthesize: async (
      options: VoiceSynthesizeOptions,
    ): Promise<VoiceSynthesizeResult> => {
      const body = {
        text: options.text,
        ...(options.voice !== undefined && { voice: options.voice }),
        ...(options.languageHint !== undefined && {
          languageHint: options.languageHint,
        }),
        ...(options.format !== undefined && { format: options.format }),
      };
      const res = await link.fetchRaw("/voice/synthesize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const parsed = (await res.json()) as VoiceSynthesizeWireBody;
      if (!res.ok) {
        return {
          ok: false,
          reason: "transport_error",
          status: res.status,
          message: parsed.error ?? "",
          ...(parsed.code !== undefined && { code: parsed.code }),
        };
      }
      return {
        ok: true,
        audio: Buffer.from(parsed.audioBase64 ?? "", "base64"),
        mimeType: parsed.mimeType ?? "",
        format: parsed.format ?? "",
      };
    },
  };
}

export default voiceModule;
