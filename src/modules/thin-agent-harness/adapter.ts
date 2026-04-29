import type {
  AgentHarness,
  AgentHarnessResult,
  AgentHarnessRunOptions,
  AgentHarnessWriter,
  KotaMessage,
  KotaModelResponse,
} from "#core/agent-harness/index.js";
import { createModelClient } from "#core/model/model-client.js";

export const THIN_AGENT_HARNESS_NAME = "thin";

const DEFAULT_MAX_TOKENS = 4096;

function rejectUnsupportedToolOptions(options: AgentHarnessRunOptions): void {
  if (options.allowedTools && options.allowedTools.length > 0) {
    throw new Error(
      'The "thin" agent harness is text-only; drop allowedTools or run a tool-capable harness.',
    );
  }
  if (options.disallowedTools && options.disallowedTools.length > 0) {
    throw new Error(
      'The "thin" agent harness is text-only; drop disallowedTools or run a tool-capable harness.',
    );
  }
  if (options.mcpServers && Object.keys(options.mcpServers).length > 0) {
    throw new Error(
      'The "thin" agent harness is text-only; drop mcpServers or run a tool-capable harness.',
    );
  }
  if (options.canUseTool) {
    throw new Error(
      'The "thin" agent harness is text-only; it has no tool loop for canUseTool to guard.',
    );
  }
  if (options.autonomyMode === "supervised") {
    throw new Error(
      'The "thin" agent harness has no tool loop and cannot route calls through the operator approval queue. ' +
        'Use autonomyMode "autonomous" or "passive", or run a tool-capable harness.',
    );
  }
  if (options.harnessOverrides !== undefined) {
    throw new Error(
      'The "thin" agent harness does not accept per-step harnessOptions. ' +
        "Drop harnessOptions[\"thin\"] or run an adapter that validates them.",
    );
  }
  if (options.onMessage !== undefined) {
    throw new Error(
      'The "thin" agent harness does not emit KotaAgentMessage frames. ' +
        "Drop onMessage or run a tool-capable harness.",
    );
  }
}

function extractText(message: KotaModelResponse): string {
  const parts: string[] = [];
  for (const block of message.content) {
    if (block.type === "text") parts.push(block.text);
  }
  return parts.join("");
}

export const thinAgentHarness: AgentHarness = {
  name: THIN_AGENT_HARNESS_NAME,
  description:
    "Single-turn text harness. Uses the core ModelClient registry for any Anthropic or OpenAI-compatible provider. No tool loop, no MCP.",
  supportsMultiTurn: true,
  supportedHookKinds: ["preRun", "postRun"] as const,
  // A text-only runner has no tool loop, so owner-questions cannot be hosted.
  // `runAgentHarness` throws at the boundary if `askOwner` is requested.
  askOwnerToolName: null,
  emitsAgentMessageStream: false,
  async run(
    options: AgentHarnessRunOptions,
    writer?: AgentHarnessWriter,
  ): Promise<AgentHarnessResult> {
    rejectUnsupportedToolOptions(options);
    if (options.abortController?.signal.aborted) {
      const reason = options.abortController.signal.reason;
      throw reason instanceof Error ? reason : new Error("Agent execution aborted");
    }

    const model = options.model;
    if (!model) {
      throw new Error(
        'The "thin" agent harness requires an explicit model on the step or config.',
      );
    }

    const system = options.systemPrompt;
    const resolved = createModelClient({ model });
    const messages: KotaMessage[] = [
      { role: "user", content: options.prompt },
    ];
    const signal = options.abortController?.signal;
    const response = await resolved.client.messages.create({
      model: resolved.model,
      max_tokens: DEFAULT_MAX_TOKENS,
      ...(system !== undefined ? { system } : {}),
      messages,
      ...(signal ? { signal } : {}),
    });

    const text = extractText(response);
    if (writer) writer.write(text);

    const usage = response.usage;
    return {
      text,
      streamedText: text,
      sessionId: response.id,
      turns: 1,
      inputTokens: usage?.input_tokens,
      outputTokens: usage?.output_tokens,
      isError: false,
    };
  },
};
