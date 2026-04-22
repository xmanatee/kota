/**
 * Transcription module — audio → text pipeline boundary.
 *
 * Defines the `TranscriptionProvider` protocol and resolves the active
 * provider via the core provider registry. Channels that receive voice
 * or audio messages call through this module rather than hitting a
 * vendor API directly. No default provider is registered; operators opt
 * in explicitly by installing a module that registers a provider.
 */

import type { KotaModule } from "#core/modules/module-types.js";

export { getTranscriptionProvider, transcribeAudio } from "./service.js";
export {
  TRANSCRIPTION_PROVIDER_TYPE,
  type TranscriptionInput,
  type TranscriptionProvider,
  TranscriptionProviderUnavailableError,
  type TranscriptionResult,
} from "./types.js";

const transcriptionModule: KotaModule = {
  name: "transcription",
  version: "1.0.0",
  description: "Audio → text provider boundary for channels that accept voice input",
};

export default transcriptionModule;
