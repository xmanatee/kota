import type {
  KotaMessage,
  KotaModelResponse,
  KotaTextBlock,
  KotaThinkingConfig,
  KotaTool,
} from "#core/agent-harness/message-protocol.js";
import type { Transport } from "#core/loop/transport.js";
import type { ModelClient } from "./model-client.js";

const STREAM_MAX_RETRIES = 3;

function abortReason(signal: AbortSignal): Error {
  const { reason } = signal;
  return reason instanceof Error ? reason : new Error("Model request aborted");
}

/** Sleep with jittered exponential backoff for retries */
function backoff(attempt: number, signal?: AbortSignal): Promise<void> {
  const delay = Math.min(1000 * 2 ** attempt, 10_000) + Math.random() * 1000;
  if (!signal) return new Promise((r) => setTimeout(r, delay));
  if (signal.aborted) return Promise.reject(abortReason(signal));
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>;
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(abortReason(signal));
    };
    timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, delay);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** Check if an error is worth retrying (transient) vs permanent. */
export function isRetryable(err: unknown): boolean {
  if (err instanceof Error && err.name === "AbortError") return false;
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes("authentication") || msg.includes("apiKey") || msg.includes("authToken")) {
    return false;
  }
  const status = (err as { status?: number }).status;
  if (typeof status === "number" && status >= 400 && status < 500 && status !== 429) {
    return false;
  }
  return true;
}

export type StreamConfig = {
  client: ModelClient;
  model: string;
  maxTokens: number;
  system: KotaTextBlock[];
  messages: KotaMessage[];
  tools: KotaTool[];
  thinkingConfig?: KotaThinkingConfig;
  transport: Transport;
  signal?: AbortSignal;
};

/** Stream an API call with retry for mid-stream failures. */
export async function streamMessage(config: StreamConfig): Promise<{
  response: KotaModelResponse;
  streamedText: string;
}> {
  const { client, model, maxTokens, system, messages, tools, thinkingConfig, transport, signal } = config;

  for (let attempt = 0; attempt <= STREAM_MAX_RETRIES; attempt++) {
    if (signal?.aborted) throw abortReason(signal);
    try {
      let streamedText = "";
      const stream = client.messages.stream({
        model,
        max_tokens: maxTokens,
        system,
        tools,
        messages,
        ...(thinkingConfig && { thinking: thinkingConfig }),
        ...(signal ? { signal } : {}),
      });

      if (thinkingConfig) {
        let thinkingStarted = false;
        stream.on("thinking", (delta) => {
          if (!thinkingStarted) {
            thinkingStarted = true;
            transport.emit({ type: "thinking_start" });
          }
          transport.emit({ type: "thinking", content: delta });
        });
      }

      stream.on("text", (text) => {
        transport.emit({ type: "text", content: text });
        streamedText += text;
      });

      const response = await stream.finalMessage();
      return { response, streamedText };
    } catch (err) {
      if (signal?.aborted) throw abortReason(signal);
      if (attempt === STREAM_MAX_RETRIES || !isRetryable(err)) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      transport.emit({
        type: "error",
        message: `\n[kota] Stream error (attempt ${attempt + 1}/${STREAM_MAX_RETRIES + 1}): ${msg}`,
      });
      await backoff(attempt, signal);
      transport.emit({ type: "status", message: "[kota] Retrying..." });
    }
  }
  throw new Error("unreachable");
}
