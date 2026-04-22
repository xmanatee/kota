/**
 * OpenAI text-to-speech provider — talks to OpenAI's `/audio/speech`
 * endpoint (or any OpenAI-compatible host) over HTTP.
 *
 * Owns per-request timeouts and retry on transient upstream failures.
 * Callers see a single success/fail from `synthesize`, never a partial
 * audio stream.
 */

import type {
  SpeechAudioFormat,
  SpeechAudioResult,
  SpeechSynthesisInput,
  SpeechSynthesisProvider,
} from "#modules/voice/types.js";

export type OpenAiTtsProviderOptions = {
  /** Resolved API key — bearer token value, not a $ENV reference. */
  apiKey: string;
  /** OpenAI-compatible base URL, e.g. "https://api.openai.com/v1". */
  baseUrl: string;
  /** Model identifier (e.g. "tts-1" or "tts-1-hd"). */
  model: string;
  /** Default voice to use when the caller does not specify one. */
  defaultVoice: string;
  /** Default audio format when the caller does not specify one. */
  defaultFormat: SpeechAudioFormat;
  /** Per-request timeout in milliseconds. */
  timeoutMs: number;
  /** Max retry attempts on transient upstream failure (0 disables). */
  maxRetries: number;
  /** Base delay between retries in milliseconds; doubles on each attempt. */
  retryBaseDelayMs?: number;
  /** Fetch implementation — exposed for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Sleep implementation — exposed for tests. Defaults to setTimeout. */
  sleep?: (ms: number) => Promise<void>;
};

/** Formats OpenAI's TTS endpoint accepts as `response_format`. */
const OPENAI_SUPPORTED_FORMATS: readonly SpeechAudioFormat[] = [
  "mp3",
  "opus",
  "aac",
  "flac",
  "wav",
  "pcm",
];

const FORMAT_TO_MIME: Record<SpeechAudioFormat, string> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  opus: "audio/ogg",
  aac: "audio/aac",
  flac: "audio/flac",
  pcm: "audio/L16",
};

export class OpenAiTtsError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "OpenAiTtsError";
    this.status = status;
  }
}

function joinUrl(baseUrl: string, path: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  return `${trimmed}${path.startsWith("/") ? path : `/${path}`}`;
}

function isTransientStatus(status: number): boolean {
  return status === 408 || status === 429 || (status >= 500 && status <= 599);
}

export class OpenAiTtsProvider implements SpeechSynthesisProvider {
  readonly name = "openai-tts";
  readonly supportedFormats = OPENAI_SUPPORTED_FORMATS;

  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #model: string;
  readonly #defaultVoice: string;
  readonly #defaultFormat: SpeechAudioFormat;
  readonly #timeoutMs: number;
  readonly #maxRetries: number;
  readonly #retryBaseDelayMs: number;
  readonly #fetch: typeof fetch;
  readonly #sleep: (ms: number) => Promise<void>;

  constructor(options: OpenAiTtsProviderOptions) {
    this.#apiKey = options.apiKey;
    this.#baseUrl = options.baseUrl;
    this.#model = options.model;
    this.#defaultVoice = options.defaultVoice;
    this.#defaultFormat = options.defaultFormat;
    this.#timeoutMs = options.timeoutMs;
    this.#maxRetries = options.maxRetries;
    this.#retryBaseDelayMs = options.retryBaseDelayMs ?? 500;
    this.#fetch = options.fetchImpl ?? fetch;
    this.#sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  get model(): string {
    return this.#model;
  }

  async synthesize(input: SpeechSynthesisInput): Promise<SpeechAudioResult> {
    const format: SpeechAudioFormat = input.format ?? this.#defaultFormat;
    if (!this.supportedFormats.includes(format)) {
      throw new OpenAiTtsError(
        `OpenAI TTS does not support format "${format}". Supported: ${this.supportedFormats.join(", ")}`,
      );
    }
    const url = joinUrl(this.#baseUrl, "/audio/speech");
    const body = {
      model: this.#model,
      voice: input.voice ?? this.#defaultVoice,
      input: input.text,
      response_format: format,
    };

    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= this.#maxRetries; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.#timeoutMs);

      try {
        const response = await this.#fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.#apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        if (response.ok) {
          const buffer = new Uint8Array(await response.arrayBuffer());
          if (buffer.byteLength === 0) {
            throw new OpenAiTtsError("OpenAI TTS returned empty audio", response.status);
          }
          return { audio: buffer, mimeType: FORMAT_TO_MIME[format], format };
        }

        const text = await safeReadText(response);
        const error = new OpenAiTtsError(
          `OpenAI TTS API error ${response.status}: ${text}`,
          response.status,
        );
        if (!isTransientStatus(response.status) || attempt === this.#maxRetries) {
          throw error;
        }
        lastError = error;
      } catch (err) {
        if (err instanceof OpenAiTtsError) throw err;
        const wrapped = wrapNetworkError(err);
        if (attempt === this.#maxRetries) throw wrapped;
        lastError = wrapped;
      } finally {
        clearTimeout(timer);
      }

      await this.#sleep(this.#retryBaseDelayMs * 2 ** attempt);
    }

    throw lastError ?? new OpenAiTtsError("OpenAI TTS synthesis failed");
  }
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 500);
  } catch {
    return "<unreadable response body>";
  }
}

function wrapNetworkError(err: unknown): OpenAiTtsError {
  if (err instanceof Error && err.name === "AbortError") {
    return new OpenAiTtsError("OpenAI TTS request timed out");
  }
  const message = err instanceof Error ? err.message : String(err);
  return new OpenAiTtsError(`OpenAI TTS request failed: ${message}`);
}
