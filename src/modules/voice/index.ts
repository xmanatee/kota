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
import { buildVoiceCommand } from "./cli.js";
import { voiceRoutes } from "./routes.js";

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
  commands: () => [buildVoiceCommand()],
  routes: () => voiceRoutes(),
};

export default voiceModule;
