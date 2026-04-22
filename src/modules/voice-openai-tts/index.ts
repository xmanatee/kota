/**
 * OpenAI text-to-speech module — registers an OpenAI-backed
 * `SpeechSynthesisProvider`. Opt-in: operators install this module and
 * configure an API key under `modules.voice-openai-tts`.
 */

import type { KotaModule, ModuleContext } from "#core/modules/module-types.js";
import type { SpeechAudioFormat } from "#modules/voice/types.js";
import { SPEECH_SYNTHESIS_PROVIDER_TYPE } from "#modules/voice/types.js";
import { OpenAiTtsProvider } from "./provider.js";

export type OpenAiTtsModuleConfig = {
  /** API key or `$ENV_VAR` reference. Required. */
  apiKey: string;
  /** OpenAI-compatible base URL. Defaults to https://api.openai.com/v1. */
  baseUrl?: string;
  /** Model identifier. Defaults to "tts-1". */
  model?: string;
  /** Default voice identifier. Defaults to "alloy". */
  defaultVoice?: string;
  /** Default output format. Defaults to "mp3". */
  defaultFormat?: SpeechAudioFormat;
  /** Per-request timeout in milliseconds. Defaults to 60000. */
  timeoutMs?: number;
  /** Max retry attempts on transient failure. Defaults to 2. */
  maxRetries?: number;
};

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MODEL = "tts-1";
const DEFAULT_VOICE = "alloy";
const DEFAULT_FORMAT: SpeechAudioFormat = "mp3";
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_RETRIES = 2;

function resolveApiKey(raw: string): string {
  if (raw.startsWith("$")) {
    return process.env[raw.slice(1)] ?? "";
  }
  return raw;
}

const openaiTtsModule: KotaModule = {
  name: "voice-openai-tts",
  version: "1.0.0",
  description: "OpenAI-compatible text-to-speech provider for the voice module",
  dependencies: ["voice"],
  configSchema: {
    type: "object",
    additionalProperties: false,
    required: ["apiKey"],
    properties: {
      apiKey: { type: "string", minLength: 1 },
      baseUrl: { type: "string", minLength: 1 },
      model: { type: "string", minLength: 1 },
      defaultVoice: { type: "string", minLength: 1 },
      defaultFormat: {
        type: "string",
        enum: ["mp3", "wav", "ogg", "opus", "aac", "flac", "pcm"],
      },
      timeoutMs: { type: "number", minimum: 1000 },
      maxRetries: { type: "number", minimum: 0 },
    },
  },

  onLoad(ctx: ModuleContext) {
    const config = ctx.getModuleConfig<OpenAiTtsModuleConfig>();
    if (!config?.apiKey) {
      ctx.log.warn(
        "voice-openai-tts: modules.voice-openai-tts.apiKey is required — provider inactive",
      );
      return;
    }
    const apiKey = resolveApiKey(config.apiKey);
    if (!apiKey) {
      ctx.log.warn(
        `voice-openai-tts: api key env var "${config.apiKey}" is not set — provider inactive`,
      );
      return;
    }

    const provider = new OpenAiTtsProvider({
      apiKey,
      baseUrl: config.baseUrl ?? DEFAULT_BASE_URL,
      model: config.model ?? DEFAULT_MODEL,
      defaultVoice: config.defaultVoice ?? DEFAULT_VOICE,
      defaultFormat: config.defaultFormat ?? DEFAULT_FORMAT,
      timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxRetries: config.maxRetries ?? DEFAULT_MAX_RETRIES,
    });

    ctx.registerProvider(SPEECH_SYNTHESIS_PROVIDER_TYPE, provider);
    ctx.log.info(`OpenAI TTS provider registered (model=${provider.model})`);
  },
};

export default openaiTtsModule;
