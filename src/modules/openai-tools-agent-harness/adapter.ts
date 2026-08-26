import type {
  AgentHarness,
  AgentHarnessResult,
  AgentHarnessRunOptions,
  AgentHarnessWriter,
} from "#core/agent-harness/index.js";
import { agentTokenUsageFromModelUsage } from "#core/agent-harness/index.js";
import { createModelClient } from "#core/model/model-client.js";
import { resolveModelOutputTokenLimit } from "#core/model/output-token-limits.js";
import { runWithAskOwnerSource } from "#core/tools/ask-owner.js";
import {
  FailureTracker,
  ToolPermissionInterruptedError,
} from "#core/tools/tool-runner.js";
import {
  attachAgentMessageStreamEvents,
  checkAborted,
  createAgentMessageEmitter,
  emitModelTurnStarted,
  emitResultMessage,
  emitToolCallMessages,
  emitToolResultMessages,
} from "./adapter-agent-messages.js";
import {
  type executeOpenaiToolCalls,
  initializeMcpManager,
  resolveScopeRoot,
  snapshotMcpToolDeclarationFingerprints,
  toolResultEntryToBlock,
} from "./adapter-runtime.js";
import {
  OPENAI_TOOLS_AGENT_HARNESS_NAME,
  OPENAI_TOOLS_ASK_OWNER_TOOL_NAME,
} from "./constants.js";
import { defaultLoopMode, type OpenaiToolsLoopMode } from "./loop-mode.js";
import {
  OPENAI_TOOLS_UNSUPPORTED_OPTIONS,
  openaiToolsReadiness,
  rejectUnsupportedOptions,
} from "./options.js";
import { createOpenaiToolsSessionRuntime } from "./session-runtime.js";
import {
  openaiToolsTokenBudgetErrorResult,
  openaiToolsTokenBudgetSource,
} from "./token-budget.js";
import {
  isTextBlock,
  isToolUseBlock,
  validateToolUseBlock,
} from "./tool-loop.js";

export {
  OPENAI_TOOLS_AGENT_HARNESS_NAME,
  OPENAI_TOOLS_ASK_OWNER_TOOL_NAME,
} from "./constants.js";

export const openaiToolsAgentHarness: AgentHarness = {
  name: OPENAI_TOOLS_AGENT_HARNESS_NAME,
  description:
    "Multi-turn tool-calling loop against an OpenAI-compatible ModelClient (OpenAI, Ollama, Groq, Together, LM Studio, vLLM, ...). Routes tools through KOTA's guarded runner and honors MCP servers plus tool-control rails.",
  supportsMultiTurn: true,
  supportedHookKinds: ["preRun", "postRun"] as const,
  askOwnerToolName: OPENAI_TOOLS_ASK_OWNER_TOOL_NAME,
  emitsAgentMessageStream: true,
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

export async function runOpenaiToolsLoop(
  options: AgentHarnessRunOptions,
  writer?: AgentHarnessWriter,
  mode: OpenaiToolsLoopMode = defaultLoopMode,
): Promise<AgentHarnessResult> {
  rejectUnsupportedOptions(options);
  checkAborted(options.abortController?.signal);

  if (!options.model) {
    throw new Error(
      'The "openai-tools" agent harness requires an explicit model on the step or config.',
    );
  }

  const mcpManager = await initializeMcpManager(options);
  try {
    const system = mode.systemPrompt(options.systemPrompt);
    const scopeRoot = resolveScopeRoot(options);
    const resolved = createModelClient({
      model: options.model,
      provider: options.modelProvider?.provider,
      baseUrl: options.modelProvider?.baseUrl,
      apiKey: options.modelProvider?.apiKey,
      scopeRoot: scopeRoot,
    });
    const outputTokenLimit = resolveModelOutputTokenLimit(
      resolved.model,
      options.modelOutputTokenLimits,
    );
    const maxTurns = options.maxTurns ?? mode.defaultMaxTurns;
    const sessionRuntime = createOpenaiToolsSessionRuntime({
      options,
      scopeRoot: scopeRoot,
      resolved,
      outputTokenLimit,
    });
    const messages = sessionRuntime.messages;
    let inputTokens = 0;
    let outputTokens = 0;
    let lastSessionId: string | undefined;
    const streamedChunks: string[] = [];
    const agentMessages = createAgentMessageEmitter(options.onMessage);
    let turnCount = 0;
    let isError = false;
    let lastSubtype: string | undefined;
    let finalText = "";
    const failureTracker = new FailureTracker();

    function currentResult(): AgentHarnessResult {
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

    async function finish(
      result: AgentHarnessResult,
    ): Promise<AgentHarnessResult> {
      emitResultMessage(agentMessages, result, lastSessionId);
      await agentMessages.flush();
      return sessionRuntime.finalize(result, lastSessionId);
    }

    for (let turn = 0; turn < maxTurns; turn += 1) {
      checkAborted(options.abortController?.signal);
      emitModelTurnStarted(agentMessages, turn);
      const mcpTools = mcpManager?.getTools() ?? [];
      const mcpPromptToolDeclarationFingerprints =
        snapshotMcpToolDeclarationFingerprints(mcpManager, mcpTools);
      const tools = mode.selectTools(
        options.allowedTools,
        options.disallowedTools,
        options.askOwner !== undefined,
        mcpTools,
      );
      sessionRuntime.validateTools(
        tools,
        mcpPromptToolDeclarationFingerprints,
      );
      const tokenBudgetSource = openaiToolsTokenBudgetSource(
        options,
        resolved.model,
        turn + 1,
      );
      const exhaustion = options.tokenBudget?.checkCanStartTurn(tokenBudgetSource);
      if (exhaustion) {
        return finish(openaiToolsTokenBudgetErrorResult({
          message: exhaustion.message,
          streamedChunks,
          lastSessionId,
          turnCount,
          inputTokens,
          outputTokens,
        }));
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
      attachAgentMessageStreamEvents(stream, writer, streamedChunks, agentMessages);

      const finalMessage = await stream.finalMessage();
      await agentMessages.flush();
      turnCount += 1;
      inputTokens += finalMessage.usage?.input_tokens ?? 0;
      outputTokens += finalMessage.usage?.output_tokens ?? 0;
      options.tokenBudget?.debitUsage(
        agentTokenUsageFromModelUsage(finalMessage.usage),
        tokenBudgetSource,
      );
      if (finalMessage.id) lastSessionId = finalMessage.id;

      const textBlocks = finalMessage.content.filter(isTextBlock);
      let toolBlocks = finalMessage.content
        .filter(isToolUseBlock)
        .map((block) => validateToolUseBlock(block));
      emitToolCallMessages(agentMessages, toolBlocks, finalMessage.id);
      const turnText = textBlocks.map((block) => block.text).join("");
      if (turnText.length > 0) finalText = turnText;
      let parsedJsonAction = false;
      if (toolBlocks.length === 0 && mode.parseJsonAction) {
        const fallbackTool = mode.parseJsonAction(
          turnText,
          `json_action_${turn + 1}`,
        );
        if (fallbackTool) {
          toolBlocks = [fallbackTool];
          parsedJsonAction = true;
          emitToolCallMessages(agentMessages, toolBlocks, finalMessage.id);
        }
      }
      const assistantContent = parsedJsonAction
        ? [...finalMessage.content, ...toolBlocks]
        : finalMessage.content;

      messages.push({
        role: "assistant",
        content: assistantContent,
      });

      const turnExhaustion = options.tokenBudget?.checkAfterDebit(tokenBudgetSource);
      if (turnExhaustion) {
        return finish(openaiToolsTokenBudgetErrorResult({
          message:
            toolBlocks.length > 0
              ? `${turnExhaustion.message} Tool calls were not executed because the harness cannot continue to consume their results.`
              : turnExhaustion.message,
          streamedChunks,
          lastSessionId,
          turnCount,
          inputTokens,
          outputTokens,
        }));
      }

      if (
        toolBlocks.length === 0 ||
        (finalMessage.stop_reason === "end_turn" && !parsedJsonAction)
      ) {
        const result = currentResult();
        return finish(mode.finalizeResponse?.(result) ?? result);
      }

      let toolResults: Awaited<ReturnType<typeof executeOpenaiToolCalls>>;
      try {
        toolResults = await mode.executeTools(toolBlocks, options, {
          mcpManager,
          mcpPromptToolDeclarationFingerprints,
          scopeRoot: scopeRoot,
          abortSignal,
          messages,
        });
      } catch (error) {
        if (!(error instanceof ToolPermissionInterruptedError)) throw error;
        const message = `canUseTool interrupted the loop: ${error.message}`;
        finalText = message;
        isError = true;
        lastSubtype = "interrupted_by_can_use_tool";
        return finish(currentResult());
      }

      const resultBlocks = toolResults.map(toolResultEntryToBlock);
      emitToolResultMessages(agentMessages, resultBlocks, lastSessionId);
      await agentMessages.flush();
      messages.push({ role: "user", content: resultBlocks });
      const failureAction = failureTracker.record(toolResults);
      if (failureAction !== "continue") {
        messages.push({
          role: "user",
          content: FailureTracker.getMessage(failureAction),
        });
      }
    }

    isError = true;
    lastSubtype = "max_turns_reached";
    finalText =
      finalText || `openai-tools harness reached maxTurns=${maxTurns} without ending.`;
    return finish(currentResult());
  } finally {
    await mcpManager?.close();
  }
}
