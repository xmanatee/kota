/**
 * `openai-tools` agent harness: a multi-turn tool-calling loop driven by any
 * OpenAI-compatible ModelClient. The adapter owns orchestration; provider
 * option validation, tool dispatch, and token-budget result shaping live in
 * local helpers.
 */

import type {
  AgentHarness,
  AgentHarnessResult,
  AgentHarnessRunOptions,
  AgentHarnessWriter,
  KotaMessage,
  KotaToolResultBlock,
} from "#core/agent-harness/index.js";
import { agentTokenUsageFromModelUsage } from "#core/agent-harness/index.js";
import { createModelClient } from "#core/model/model-client.js";
import { resolveModelOutputTokenLimit } from "#core/model/output-token-limits.js";
import { runWithAskOwnerSource } from "#core/tools/ask-owner.js";
import {
  DEFAULT_MAX_TURNS,
  OPENAI_TOOLS_AGENT_HARNESS_NAME,
  OPENAI_TOOLS_ASK_OWNER_TOOL_NAME,
} from "./constants.js";
import {
  OPENAI_TOOLS_UNSUPPORTED_OPTIONS,
  openaiToolsReadiness,
  rejectUnsupportedOptions,
} from "./options.js";
import {
  openaiToolsTokenBudgetErrorResult,
  openaiToolsTokenBudgetSource,
} from "./token-budget.js";
import {
  type DenialOutcome,
  dispatchToolCall,
  isTextBlock,
  isToolUseBlock,
  selectToolDefinitions,
} from "./tool-loop.js";

export {
  OPENAI_TOOLS_AGENT_HARNESS_NAME,
  OPENAI_TOOLS_ASK_OWNER_TOOL_NAME,
} from "./constants.js";

function checkAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    const reason = signal.reason;
    throw reason instanceof Error ? reason : new Error("Agent execution aborted");
  }
}

export const openaiToolsAgentHarness: AgentHarness = {
  name: OPENAI_TOOLS_AGENT_HARNESS_NAME,
  description:
    "Multi-turn tool-calling loop against an OpenAI-compatible ModelClient (OpenAI, Ollama, Groq, Together, LM Studio, vLLM, ...). Honors canUseTool, allowedTools, disallowedTools.",
  supportsMultiTurn: true,
  supportedHookKinds: ["preRun", "postRun"] as const,
  askOwnerToolName: OPENAI_TOOLS_ASK_OWNER_TOOL_NAME,
  emitsAgentMessageStream: false,
  toolControl: "kota",
  readiness: openaiToolsReadiness,
  unsupportedRunOptions: OPENAI_TOOLS_UNSUPPORTED_OPTIONS,
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
  const resolved = createModelClient({
    model: options.model,
    provider: options.modelProvider?.provider,
    baseUrl: options.modelProvider?.baseUrl,
    apiKey: options.modelProvider?.apiKey,
    projectDir: options.cwd,
  });
  const outputTokenLimit = resolveModelOutputTokenLimit(
    resolved.model,
    options.modelOutputTokenLimits,
  );
  const tools = selectToolDefinitions(
    options.allowedTools,
    options.disallowedTools,
    options.askOwner !== undefined,
  );
  const maxTurns = options.maxTurns ?? DEFAULT_MAX_TURNS;

  const messages: KotaMessage[] = [{ role: "user", content: options.prompt }];
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
    const tokenBudgetSource = openaiToolsTokenBudgetSource(
      options,
      resolved.model,
      turn + 1,
    );
    const exhaustion = options.tokenBudget?.checkCanStartTurn(tokenBudgetSource);
    if (exhaustion) {
      return openaiToolsTokenBudgetErrorResult({
        message: exhaustion.message,
        streamedChunks,
        lastSessionId,
        turnCount,
        inputTokens,
        outputTokens,
      });
    }

    const abortSignal = options.abortController?.signal;
    const stream = resolved.client.messages.stream({
      model: resolved.model,
      max_tokens: outputTokenLimit.maxTokens,
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
    options.tokenBudget?.debitUsage(
      agentTokenUsageFromModelUsage(finalMessage.usage),
      tokenBudgetSource,
    );
    if (finalMessage.id) lastSessionId = finalMessage.id;

    const textBlocks = finalMessage.content.filter(isTextBlock);
    const toolBlocks = finalMessage.content.filter(isToolUseBlock);
    const turnText = textBlocks.map((block) => block.text).join("");
    if (turnText.length > 0) finalText = turnText;

    messages.push({
      role: "assistant",
      content: finalMessage.content,
    });

    const turnExhaustion = options.tokenBudget?.checkAfterDebit(tokenBudgetSource);
    if (turnExhaustion) {
      return openaiToolsTokenBudgetErrorResult({
        message:
          toolBlocks.length > 0
            ? `${turnExhaustion.message} Tool calls were not executed because the harness cannot continue to consume their results.`
            : turnExhaustion.message,
        streamedChunks,
        lastSessionId,
        turnCount,
        inputTokens,
        outputTokens,
      });
    }

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
        workflowContext: options.workflowContext,
        tokenBudget: options.tokenBudget,
        cwd: options.cwd,
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
    text:
      finalText ||
      `openai-tools harness reached maxTurns=${maxTurns} without ending.`,
    streamedText: streamedChunks.join(""),
    ...(lastSessionId !== undefined ? { sessionId: lastSessionId } : {}),
    turns: turnCount,
    inputTokens,
    outputTokens,
    isError,
    subtype: lastSubtype,
  };
}
