/**
 * Whisper transcription module — registers an OpenAI Whisper-backed
 * `TranscriptionProvider`. Opt-in: operators install this module and
 * configure an API key under `modules.transcription-whisper`.
 */

import type { KotaModule, ModuleRuntimeContext } from "#core/modules/module-types.js";
import { TRANSCRIPTION_PROVIDER_TYPE } from "#modules/transcription/types.js";
import { WhisperTranscriptionProvider } from "./provider.js";

export type WhisperModuleConfig = {
  /** API key or `$ENV_VAR` reference. Required. */
  apiKey: string;
  /** OpenAI-compatible base URL. Defaults to https://api.openai.com/v1. */
  baseUrl?: string;
  /** Model identifier. Defaults to "whisper-1". */
  model?: string;
  /** Per-request timeout in milliseconds. Defaults to 60000. */
  timeoutMs?: number;
  /** Max retry attempts on transient failure. Defaults to 2. */
  maxRetries?: number;
};

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MODEL = "whisper-1";
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_RETRIES = 2;

function resolveApiKey(raw: string): string {
  if (raw.startsWith("$")) {
    return process.env[raw.slice(1)] ?? "";
  }
  return raw;
}

const whisperModule: KotaModule = {
  name: "transcription-whisper",
  version: "1.0.0",
  description: "OpenAI Whisper transcription provider (channel audio → text)",
  dependencies: ["transcription"],
  configSchema: {
    type: "object",
    additionalProperties: false,
    required: ["apiKey"],
    properties: {
      apiKey: { type: "string", minLength: 1 },
      baseUrl: { type: "string", minLength: 1 },
      model: { type: "string", minLength: 1 },
      timeoutMs: { type: "number", minimum: 1000 },
      maxRetries: { type: "number", minimum: 0 },
    },
  },

  onLoad(ctx: ModuleRuntimeContext) {
    const config = ctx.getModuleConfig<WhisperModuleConfig>();
    if (!config?.apiKey) {
      ctx.log.warn(
        "transcription-whisper: modules.transcription-whisper.apiKey is required — provider inactive",
      );
      return;
    }

    const apiKey = resolveApiKey(config.apiKey);
    if (!apiKey) {
      ctx.log.warn(
        `transcription-whisper: api key env var "${config.apiKey}" is not set — provider inactive`,
      );
      return;
    }

    const provider = new WhisperTranscriptionProvider({
      apiKey,
      baseUrl: config.baseUrl ?? DEFAULT_BASE_URL,
      model: config.model ?? DEFAULT_MODEL,
      timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxRetries: config.maxRetries ?? DEFAULT_MAX_RETRIES,
    });

    ctx.registerProvider(TRANSCRIPTION_PROVIDER_TYPE, provider);
    ctx.log.info(`Whisper transcription provider registered (model=${provider.model})`);
  },
};

export default whisperModule;
