/**
 * Whisper transcription provider — talks to OpenAI Whisper (or any
 * OpenAI-compatible `/audio/transcriptions` endpoint) over HTTP.
 *
 * Owns request-level timeouts and retry on transient failures. Channels
 * see a single success/fail from `transcribe`, never a partial state.
 */

import type {
  TranscriptionInput,
  TranscriptionProvider,
  TranscriptionResult,
} from "#modules/transcription/types.js";

export type WhisperProviderOptions = {
  /** Resolved API key — bearer token value, not a $ENV reference. */
  apiKey: string;
  /** OpenAI-compatible base URL, e.g. "https://api.openai.com/v1". */
  baseUrl: string;
  /** Model identifier passed to the API (e.g. "whisper-1"). */
  model: string;
  /** Per-request timeout in milliseconds. */
  timeoutMs: number;
  /** Maximum retry attempts on transient upstream failures (0 disables retry). */
  maxRetries: number;
  /** Base delay between retries in milliseconds; doubles on each attempt. */
  retryBaseDelayMs?: number;
  /**
   * Fetch implementation; exposed for tests. Defaults to global `fetch`.
   */
  fetchImpl?: typeof fetch;
  /** Sleep implementation; exposed for tests. Defaults to setTimeout. */
  sleep?: (ms: number) => Promise<void>;
};

/**
 * Extension map for mime types the API recognises by filename suffix.
 * Whisper infers the audio format from the uploaded filename's extension.
 */
const MIME_TO_EXT: Record<string, string> = {
  "audio/ogg": "ogg",
  "audio/oga": "ogg",
  "audio/opus": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/m4a": "m4a",
  "audio/aac": "m4a",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
  "audio/webm": "webm",
  "audio/flac": "flac",
};

function filenameFor(input: TranscriptionInput): string {
  if (input.filename?.includes(".")) return input.filename;
  const ext = MIME_TO_EXT[input.mimeType.toLowerCase()] ?? "bin";
  return `audio.${ext}`;
}

function joinUrl(baseUrl: string, path: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  return `${trimmed}${path.startsWith("/") ? path : `/${path}`}`;
}

function isTransientStatus(status: number): boolean {
  return status === 408 || status === 429 || (status >= 500 && status <= 599);
}

export class WhisperTranscriptionError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "WhisperTranscriptionError";
    this.status = status;
  }
}

export class WhisperTranscriptionProvider implements TranscriptionProvider {
  readonly name = "openai-whisper";

  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #model: string;
  readonly #timeoutMs: number;
  readonly #maxRetries: number;
  readonly #retryBaseDelayMs: number;
  readonly #fetch: typeof fetch;
  readonly #sleep: (ms: number) => Promise<void>;

  constructor(options: WhisperProviderOptions) {
    this.#apiKey = options.apiKey;
    this.#baseUrl = options.baseUrl;
    this.#model = options.model;
    this.#timeoutMs = options.timeoutMs;
    this.#maxRetries = options.maxRetries;
    this.#retryBaseDelayMs = options.retryBaseDelayMs ?? 500;
    this.#fetch = options.fetchImpl ?? fetch;
    this.#sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  get model(): string {
    return this.#model;
  }

  async transcribe(input: TranscriptionInput): Promise<TranscriptionResult> {
    const url = joinUrl(this.#baseUrl, "/audio/transcriptions");
    const filename = filenameFor(input);

    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= this.#maxRetries; attempt += 1) {
      const form = new FormData();
      form.append("file", toAudioBlob(input.audio, input.mimeType), filename);
      form.append("model", this.#model);
      form.append("response_format", "verbose_json");
      if (input.languageHint) form.append("language", input.languageHint);

      const controller = new AbortController();
      const timeoutHandle = setTimeout(() => controller.abort(), this.#timeoutMs);

      try {
        const response = await this.#fetch(url, {
          method: "POST",
          headers: { Authorization: `Bearer ${this.#apiKey}` },
          body: form,
          signal: controller.signal,
        });

        if (response.ok) {
          const data = (await response.json()) as {
            text?: string;
            language?: string;
          };
          if (typeof data.text !== "string") {
            throw new WhisperTranscriptionError(
              "Whisper response missing text field",
              response.status,
            );
          }
          const result: TranscriptionResult = { text: data.text };
          if (typeof data.language === "string" && data.language) {
            result.language = data.language;
          }
          return result;
        }

        const body = await safeReadText(response);
        const error = new WhisperTranscriptionError(
          `Whisper API error ${response.status}: ${body}`,
          response.status,
        );
        if (!isTransientStatus(response.status) || attempt === this.#maxRetries) {
          throw error;
        }
        lastError = error;
      } catch (err) {
        if (err instanceof WhisperTranscriptionError) throw err;
        const wrapped = wrapNetworkError(err);
        if (attempt === this.#maxRetries) throw wrapped;
        lastError = wrapped;
      } finally {
        clearTimeout(timeoutHandle);
      }

      await this.#sleep(this.#retryBaseDelayMs * 2 ** attempt);
    }

    throw lastError ?? new WhisperTranscriptionError("Whisper transcription failed");
  }
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 500);
  } catch {
    return "<unreadable response body>";
  }
}

function toAudioBlob(audio: Uint8Array, mimeType: string): Blob {
  const copy = new Uint8Array(audio.byteLength);
  copy.set(audio);
  return new Blob([copy], { type: mimeType });
}

function wrapNetworkError(err: unknown): WhisperTranscriptionError {
  if (err instanceof Error && err.name === "AbortError") {
    return new WhisperTranscriptionError("Whisper request timed out");
  }
  const message = err instanceof Error ? err.message : String(err);
  return new WhisperTranscriptionError(`Whisper request failed: ${message}`);
}
