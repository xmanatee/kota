/**
 * `openai-tools` agent harness — a multi-turn tool-calling loop driven by any
 * OpenAI-compatible ModelClient.
 *
 * The adapter reuses `model-clients` for wire translation and the core tool
 * registry for execution, so a registered KOTA tool is callable from this
 * harness exactly as it is from `claude-agent-sdk`. Guardrails (`canUseTool`,
 * `allowedTools`, `disallowedTools`) are applied inside the loop; options that
 * are claude-SDK-specific are rejected loudly at the boundary instead of being
 * silently ignored.
 */

import type {
  AgentCanUseTool,
  AgentHarness,
  AgentHarnessResult,
  AgentHarnessRunOptions,
  AgentHarnessWriter,
  KotaContentBlock,
  KotaMessage,
  KotaTextBlock,
  KotaTool,
  KotaToolResultBlock,
  KotaToolUseBlock,
} from "#core/agent-harness/index.js";
import { createModelClient } from "#core/model/model-client.js";
import { runWithAskOwnerSource } from "#core/tools/ask-owner.js";
import { executeTool, getAllTools } from "#core/tools/index.js";

export const OPENAI_TOOLS_AGENT_HARNESS_NAME = "openai-tools";
export const OPENAI_TOOLS_ASK_OWNER_TOOL_NAME = "ask_owner";

const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_MAX_TURNS = 25;

function isToolUseBlock(block: KotaContentBlock): block is KotaToolUseBlock {
  return block.type === "tool_use";
}

function isTextBlock(block: KotaContentBlock): block is KotaTextBlock {
  return block.type === "text";
}

function rejectUnsupportedOptions(options: AgentHarnessRunOptions): void {
  if (options.mcpServers && Object.keys(options.mcpServers).length > 0) {
    throw new Error(
      'The "openai-tools" agent harness does not host MCP servers. Drop mcpServers ' +
        "or run the claude-agent-sdk harness which proxies them through the SDK.",
    );
  }
  if (options.autonomyMode === "supervised") {
    throw new Error(
      'The "openai-tools" agent harness cannot route tool calls through the operator approval queue. ' +
        'Use autonomyMode "autonomous" or "passive", or run claude-agent-sdk.',
    );
  }
  if (options.persistSession === true) {
    throw new Error(
      'The "openai-tools" agent harness does not persist sessions. ' +
        "Drop persistSession or run claude-agent-sdk for native session resumption.",
    );
  }
  if (options.harnessOverrides !== undefined) {
    throw new Error(
      'The "openai-tools" agent harness does not accept per-step harnessOptions. ' +
        "Drop harnessOptions[\"openai-tools\"] or run an adapter that validates them.",
    );
  }
  if (options.enableFileCheckpointing === true) {
    throw new Error(
      'The "openai-tools" agent harness does not support file checkpointing. ' +
        "Drop enableFileCheckpointing or run claude-agent-sdk.",
    );
  }
  if (options.thinkingEnabled === true) {
    throw new Error(
      'The "openai-tools" agent harness does not host extended thinking. ' +
        "Drop thinkingEnabled/thinkingBudget or run claude-agent-sdk.",
    );
  }
  if (options.onMessage !== undefined) {
    throw new Error(
      'The "openai-tools" agent harness does not emit KotaAgentMessage frames. ' +
        "Drop onMessage or run claude-agent-sdk.",
    );
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function looksLikeRawFallback(input: unknown): boolean {
  if (!isPlainRecord(input)) return false;
  const keys = Object.keys(input);
  return keys.length === 1 && keys[0] === "_raw" && typeof input._raw === "string";
}

function validateToolUseBlock(
  block: KotaToolUseBlock,
): Record<string, unknown> {
  if (typeof block.name !== "string" || block.name.length === 0) {
    throw new Error(
      `OpenAI model returned a malformed tool_call: missing tool name (id=${String(block.id)}).`,
    );
  }
  if (looksLikeRawFallback(block.input)) {
    throw new Error(
      `OpenAI model returned malformed JSON arguments for tool "${block.name}" ` +
        "(non-parseable JSON in tool_call.function.arguments).",
    );
  }
  if (!isPlainRecord(block.input)) {
    throw new Error(
      `OpenAI model returned a malformed tool_call for "${block.name}": input must be a JSON object, got ${
        block.input === null ? "null" : Array.isArray(block.input) ? "array" : typeof block.input
      }.`,
    );
  }
  return block.input;
}

function selectToolDefinitions(
  allowed: readonly string[] | undefined,
  disallowed: readonly string[] | undefined,
  includeAskOwner: boolean,
): KotaTool[] {
  const all = getAllTools();
  const denySet = new Set(disallowed ?? []);
  const allowSet = allowed && allowed.length > 0 ? new Set(allowed) : null;
  // Owner-questions must reach the agent when the caller requested them,
  // even if a restrictive allowedTools list would have filtered the tool out.
  // The registry already excludes `ask_owner` from `disallowed` when the
  // caller wants it, but the allowedTools path needs an explicit allowance.
  if (includeAskOwner && allowSet) allowSet.add(OPENAI_TOOLS_ASK_OWNER_TOOL_NAME);
  return all.filter((tool) => {
    if (denySet.has(tool.name)) return false;
    if (allowSet && !allowSet.has(tool.name)) return false;
    return true;
  });
}

type DenialOutcome = {
  block: KotaToolResultBlock;
  interrupt: boolean;
  message: string;
};

async function dispatchToolCall(
  call: KotaToolUseBlock,
  options: {
    canUseTool: AgentCanUseTool | undefined;
    allowedTools: readonly string[] | undefined;
    disallowedTools: readonly string[] | undefined;
    abortSignal: AbortSignal | undefined;
  },
): Promise<{ result: KotaToolResultBlock; denial?: DenialOutcome }> {
  const validatedInput = validateToolUseBlock(call);

  const denySet = new Set(options.disallowedTools ?? []);
  if (denySet.has(call.name)) {
    const denial: DenialOutcome = {
      block: {
        type: "tool_result",
        tool_use_id: call.id,
        content: `Tool "${call.name}" is in disallowedTools and cannot run.`,
        is_error: true,
      },
      interrupt: false,
      message: `disallowedTools blocked ${call.name}`,
    };
    return { result: denial.block, denial };
  }

  if (
    options.allowedTools &&
    options.allowedTools.length > 0 &&
    !options.allowedTools.includes(call.name)
  ) {
    const denial: DenialOutcome = {
      block: {
        type: "tool_result",
        tool_use_id: call.id,
        content: `Tool "${call.name}" is not in allowedTools and cannot run.`,
        is_error: true,
      },
      interrupt: false,
      message: `allowedTools excluded ${call.name}`,
    };
    return { result: denial.block, denial };
  }

  let effectiveInput: Record<string, unknown> = validatedInput;
  if (options.canUseTool) {
    const abortController = new AbortController();
    if (options.abortSignal) {
      if (options.abortSignal.aborted) abortController.abort(options.abortSignal.reason);
      else
        options.abortSignal.addEventListener(
          "abort",
          () => abortController.abort(options.abortSignal?.reason),
          { once: true },
        );
    }
    const decision = await options.canUseTool(call.name, validatedInput, {
      signal: abortController.signal,
      suggestions: [],
      toolUseId: call.id,
    });
    if (decision.behavior === "deny") {
      const denial: DenialOutcome = {
        block: {
          type: "tool_result",
          tool_use_id: call.id,
          content: decision.message,
          is_error: true,
        },
        interrupt: decision.interrupt === true,
        message: decision.message,
      };
      return { result: denial.block, denial };
    }
    if (decision.behavior === "allow" && isPlainRecord(decision.updatedInput)) {
      effectiveInput = decision.updatedInput;
    }
  }

  const toolResult = await executeTool(call.name, effectiveInput);
  return {
    result: {
      type: "tool_result",
      tool_use_id: call.id,
      content: toolResult.blocks ? toolResult.blocks : toolResult.content,
      ...(toolResult.structuredContent ? { structuredContent: toolResult.structuredContent } : {}),
      ...(toolResult._meta ? { _meta: toolResult._meta } : {}),
      is_error: toolResult.is_error === true,
    },
  };
}

function checkAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    const reason = signal.reason;
    throw reason instanceof Error ? reason : new Error("Agent execution aborted");
  }
}

export const openaiToolsAgentHarness: AgentHarness = {
  name: OPENAI_TOOLS_AGENT_HARNESS_NAME,
  description:
    "Multi-turn tool-calling loop against an OpenAI-compatible ModelClient (OpenAI, Ollama, Groq, Together, LM Studio, vLLM, …). Honors canUseTool, allowedTools, disallowedTools.",
  supportsMultiTurn: true,
  supportedHookKinds: ["preRun", "postRun"] as const,
  askOwnerToolName: OPENAI_TOOLS_ASK_OWNER_TOOL_NAME,
  emitsAgentMessageStream: false,
  toolControl: "kota",
  async run(
    options: AgentHarnessRunOptions,
    writer?: AgentHarnessWriter,
  ): Promise<AgentHarnessResult> {
    if (options.askOwner) {
      return runWithAskOwnerSource(options.askOwner.source, () =>
        runOpenaiToolsLoop(options, writer),
      );
    }
    return runOpenaiToolsLoop(options, writer);
  },
};

async function runOpenaiToolsLoop(
  options: AgentHarnessRunOptions,
  writer?: AgentHarnessWriter,
): Promise<AgentHarnessResult> {
    rejectUnsupportedOptions(options);
    checkAborted(options.abortController?.signal);

    if (!options.model) {
      throw new Error(
        'The "openai-tools" agent harness requires an explicit model on the step or config.',
      );
    }

    const system = options.systemPrompt;
    const resolved = createModelClient({ model: options.model });
    const tools = selectToolDefinitions(
      options.allowedTools,
      options.disallowedTools,
      options.askOwner !== undefined,
    );
    const maxTurns = options.maxTurns ?? DEFAULT_MAX_TURNS;

    const messages: KotaMessage[] = [
      { role: "user", content: options.prompt },
    ];

    let inputTokens = 0;
    let outputTokens = 0;
    let lastSessionId: string | undefined;
    const streamedChunks: string[] = [];
    let turnCount = 0;
    let isError = false;
    let lastSubtype: string | undefined;
    let finalText = "";

    for (let turn = 0; turn < maxTurns; turn += 1) {
      checkAborted(options.abortController?.signal);

      const abortSignal = options.abortController?.signal;
      const stream = resolved.client.messages.stream({
        model: resolved.model,
        max_tokens: DEFAULT_MAX_TOKENS,
        ...(system !== undefined ? { system } : {}),
        messages,
        ...(tools.length > 0 ? { tools } : {}),
        effort: options.effort,
        ...(abortSignal ? { signal: abortSignal } : {}),
      });
      stream.on("text", (delta) => {
        streamedChunks.push(delta);
        if (writer) writer.write(delta);
      });

      const finalMessage = await stream.finalMessage();
      turnCount += 1;
      inputTokens += finalMessage.usage?.input_tokens ?? 0;
      outputTokens += finalMessage.usage?.output_tokens ?? 0;
      if (finalMessage.id) lastSessionId = finalMessage.id;

      const textBlocks = finalMessage.content.filter(isTextBlock);
      const toolBlocks = finalMessage.content.filter(isToolUseBlock);
      const turnText = textBlocks.map((block) => block.text).join("");
      if (turnText.length > 0) finalText = turnText;

      messages.push({
        role: "assistant",
        content: finalMessage.content,
      });

      if (toolBlocks.length === 0 || finalMessage.stop_reason === "end_turn") {
        return {
          text: finalText,
          streamedText: streamedChunks.join(""),
          ...(lastSessionId !== undefined ? { sessionId: lastSessionId } : {}),
          turns: turnCount,
          inputTokens,
          outputTokens,
          isError,
          ...(lastSubtype !== undefined ? { subtype: lastSubtype } : {}),
        };
      }

      const resultBlocks: KotaToolResultBlock[] = [];
      let interrupted: DenialOutcome | undefined;
      for (const call of toolBlocks) {
        const dispatched = await dispatchToolCall(call, {
          canUseTool: options.canUseTool,
          allowedTools: options.allowedTools,
          disallowedTools: options.disallowedTools,
          abortSignal: options.abortController?.signal,
        });
        resultBlocks.push(dispatched.result);
        if (dispatched.denial?.interrupt && !interrupted) {
          interrupted = dispatched.denial;
        }
      }

      messages.push({ role: "user", content: resultBlocks });

      if (interrupted) {
        const message = `canUseTool interrupted the loop: ${interrupted.message}`;
        finalText = message;
        isError = true;
        lastSubtype = "interrupted_by_can_use_tool";
        return {
          text: finalText,
          streamedText: streamedChunks.join(""),
          ...(lastSessionId !== undefined ? { sessionId: lastSessionId } : {}),
          turns: turnCount,
          inputTokens,
          outputTokens,
          isError,
          subtype: lastSubtype,
        };
      }
    }

    isError = true;
    lastSubtype = "max_turns_reached";
    return {
      text: finalText || `openai-tools harness reached maxTurns=${maxTurns} without ending.`,
      streamedText: streamedChunks.join(""),
      ...(lastSessionId !== undefined ? { sessionId: lastSessionId } : {}),
      turns: turnCount,
      inputTokens,
      outputTokens,
      isError,
      subtype: lastSubtype,
    };
}
