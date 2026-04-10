import type Anthropic from "@anthropic-ai/sdk";
import type { CostTracker } from "../core/loop/cost.js";
import type { ModelClient } from "../model/model-client.js";
import { isRetryable } from "../model/streaming.js";
import type { Transport } from "../core/loop/transport.js";
import { STREAM_MAX_RETRIES, streamBackoff } from "./retry.js";

const ARCHITECT_SYSTEM = `You are an expert planner analyzing a task.

Produce a detailed execution plan:
1. List each step with specific actions and expected outputs
2. For code: specify files, exact changes (find → replace), dependency order
3. For research: specify queries, sources to check, what to extract
4. For analysis: specify data sources, computations, visualizations
5. For writing: specify sections, key points, format
6. Be precise — the executor will follow your plan literally

Do NOT execute the plan. Describe the steps in natural language.`;

export type ArchitectOptions = {
  client: ModelClient;
  model: string;
  maxTokens: number;
  systemContext: string;
  messages: Anthropic.Messages.MessageParam[];
  costTracker?: CostTracker;
  verbose?: boolean;
  thinking?: Anthropic.Messages.ThinkingConfigParam;
  transport?: Transport;
};

export async function runArchitectPass(opts: ArchitectOptions): Promise<string> {
  const { client, model, maxTokens, systemContext, messages, costTracker, verbose, thinking, transport } = opts;
  if (verbose && transport) transport.emit({ type: "status", message: "[kota] Architect pass — reasoning..." });

  const systemText = `${ARCHITECT_SYSTEM}\n\nProject context:\n${systemContext}`;

  for (let attempt = 0; attempt <= STREAM_MAX_RETRIES; attempt++) {
    try {
      const stream = client.messages.stream({
        model,
        max_tokens: maxTokens,
        system: [{ type: "text", text: systemText, cache_control: { type: "ephemeral" } }],
        messages,
        ...(thinking && { thinking }),
      });

      let plan = "";
      if (thinking) {
        stream.on("thinking", (delta) => {
          if (transport) transport.emit({ type: "thinking", content: delta });
        });
      }
      stream.on("text", (text) => {
        if (transport) transport.emit({ type: "progress", content: text, source: "architect" });
        plan += text;
      });

      const response = await stream.finalMessage();
      if (plan && transport) transport.emit({ type: "progress", content: "\n", source: "architect" });
      if (costTracker) costTracker.addUsage(model, response.usage);
      return plan;
    } catch (err) {
      if (attempt < STREAM_MAX_RETRIES && isRetryable(err)) {
        const msg = err instanceof Error ? err.message : String(err);
        if (transport) transport.emit({ type: "error", message: `[kota] Architect stream error (attempt ${attempt + 1}/${STREAM_MAX_RETRIES + 1}): ${msg.slice(0, 200)}` });
        await streamBackoff(attempt);
        continue;
      }
      throw err;
    }
  }
  throw new Error("unreachable");
}
