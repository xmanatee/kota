import type Anthropic from "@anthropic-ai/sdk";
import type { Transport } from "../loop/transport.js";
import type { ModelClient } from "./model-client.js";

const STREAM_MAX_RETRIES = 3;

/** Sleep with jittered exponential backoff for retries */
function backoff(attempt: number): Promise<void> {
  const delay = Math.min(1000 * 2 ** attempt, 10_000) + Math.random() * 1000;
  return new Promise((r) => setTimeout(r, delay));
}

/** Check if an error is worth retrying (transient) vs permanent. */
export function isRetryable(err: unknown): boolean {
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
  system: Anthropic.Messages.TextBlockParam[];
  messages: Anthropic.MessageParam[];
  tools: Anthropic.Tool[];
  thinkingConfig?: Anthropic.Messages.ThinkingConfigParam;
  transport: Transport;
};

/** Stream an API call with retry for mid-stream failures. */
export async function streamMessage(config: StreamConfig): Promise<{
  response: Anthropic.Message;
  streamedText: string;
}> {
  const { client, model, maxTokens, system, messages, tools, thinkingConfig, transport } = config;

  for (let attempt = 0; attempt <= STREAM_MAX_RETRIES; attempt++) {
    try {
      let streamedText = "";
      const stream = client.messages.stream({
        model,
        max_tokens: maxTokens,
        system,
        tools,
        messages,
        ...(thinkingConfig && { thinking: thinkingConfig }),
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
      if (attempt === STREAM_MAX_RETRIES || !isRetryable(err)) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      transport.emit({
        type: "error",
        message: `\n[kota] Stream error (attempt ${attempt + 1}/${STREAM_MAX_RETRIES + 1}): ${msg}`,
      });
      await backoff(attempt);
      transport.emit({ type: "status", message: "[kota] Retrying..." });
    }
  }
  throw new Error("unreachable");
}
