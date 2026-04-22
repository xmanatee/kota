import type Anthropic from "@anthropic-ai/sdk";
import type {
  AgentHarness,
  AgentHarnessResult,
  AgentHarnessRunOptions,
  AgentHarnessWriter,
  AgentSystemPrompt,
} from "#core/agent-harness/index.js";
import { createModelClient } from "#core/model/model-client.js";

export const THIN_AGENT_HARNESS_NAME = "thin";

const DEFAULT_MAX_TOKENS = 4096;

function extractSystemText(prompt: AgentSystemPrompt | undefined): string | undefined {
  if (prompt === undefined) return undefined;
  if (typeof prompt === "string") return prompt;
  throw new Error(
    'The "thin" agent harness only accepts a string systemPrompt. ' +
      "Preset system prompts are claude-agent-sdk specific and cannot be honored here.",
  );
}

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
}

function extractText(message: Anthropic.Message): string {
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

    const system = extractSystemText(options.systemPrompt);
    const resolved = createModelClient({ model });
    const response = await resolved.client.messages.create({
      model: resolved.model,
      max_tokens: DEFAULT_MAX_TOKENS,
      ...(system !== undefined ? { system } : {}),
      messages: [{ role: "user", content: options.prompt }],
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
