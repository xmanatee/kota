import type {
  AgentHarness,
  AgentHarnessResult,
  AgentHarnessRunOptions,
  AgentHarnessWriter,
  KotaToolUseBlock,
} from "#core/agent-harness/index.js";
import { agentTokenUsageFromModelUsage } from "#core/agent-harness/index.js";
import { createModelClient } from "#core/model/model-client.js";
import { resolveModelOutputTokenLimit } from "#core/model/output-token-limits.js";
import { runWithAskOwnerSource } from "#core/tools/ask-owner.js";
import {
  executeToolCalls,
  FailureTracker,
  ToolPermissionInterruptedError,
  type ToolResultEntry,
} from "#core/tools/tool-runner.js";
import {
  initializeMcpManager,
  resolveProjectDir,
  snapshotMcpToolDeclarationFingerprints,
  toolResultEntryToBlock,
} from "./adapter-runtime.js";
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
import { createOpenaiToolsSessionRuntime } from "./session-runtime.js";
import {
  openaiToolsTokenBudgetErrorResult,
  openaiToolsTokenBudgetSource,
} from "./token-budget.js";
import {
  isTextBlock,
  isToolUseBlock,
  selectToolDefinitions,
  validateToolUseBlock,
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
    "Multi-turn tool-calling loop against an OpenAI-compatible ModelClient (OpenAI, Ollama, Groq, Together, LM Studio, vLLM, ...). Routes tools through KOTA's guarded runner and honors MCP servers plus tool-control rails.",
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

  const mcpManager = await initializeMcpManager(options);
  try {
    const system = options.systemPrompt;
    const projectDir = resolveProjectDir(options);
    const resolved = createModelClient({
      model: options.model,
      provider: options.modelProvider?.provider,
      baseUrl: options.modelProvider?.baseUrl,
      apiKey: options.modelProvider?.apiKey,
      projectDir,
    });
    const outputTokenLimit = resolveModelOutputTokenLimit(
      resolved.model,
      options.modelOutputTokenLimits,
    );
    const maxTurns = options.maxTurns ?? DEFAULT_MAX_TURNS;
    const sessionRuntime = createOpenaiToolsSessionRuntime({
      options,
      projectDir,
      resolved,
      outputTokenLimit,
    });
    const messages = sessionRuntime.messages;
    let inputTokens = 0;
    let outputTokens = 0;
    let lastSessionId: string | undefined;
    const streamedChunks: string[] = [];
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

    for (let turn = 0; turn < maxTurns; turn += 1) {
      checkAborted(options.abortController?.signal);
      const mcpTools = mcpManager?.getTools() ?? [];
      const mcpPromptToolDeclarationFingerprints =
        snapshotMcpToolDeclarationFingerprints(mcpManager, mcpTools);
      const tools = selectToolDefinitions(
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
      const toolBlocks = finalMessage.content
        .filter(isToolUseBlock)
        .map((block): KotaToolUseBlock => validateToolUseBlock(block));
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
        return sessionRuntime.finalize(currentResult(), lastSessionId);
      }

      let toolResults: ToolResultEntry[];
      try {
        toolResults = await executeToolCalls(toolBlocks, {
          resultLimit: 50_000,
          verbose: options.verbose === true,
          autonomyMode: options.autonomyMode ?? "autonomous",
          ...(mcpManager !== undefined ? { mcpManager } : {}),
          ...(mcpPromptToolDeclarationFingerprints !== undefined
            ? { mcpPromptToolDeclarationFingerprints }
            : {}),
          cwd: projectDir,
          ...(options.guardrailsConfig !== undefined
            ? { guardrailsConfig: options.guardrailsConfig }
            : {}),
          ...(options.clientApprovalResolver !== undefined
            ? { clientApprovalResolver: options.clientApprovalResolver }
            : {}),
          ...(options.workflowContext !== undefined
            ? {
                sessionId: options.workflowContext.spanId,
                workflowContext: options.workflowContext,
                scopeId: options.workflowContext.scopeId,
                projectId: options.workflowContext.projectId,
              }
            : {}),
          messages,
          ...(options.idempotencyStore !== undefined
            ? { idempotencyStore: options.idempotencyStore }
            : {}),
          ...(options.tokenBudget !== undefined
            ? { tokenBudget: options.tokenBudget }
            : {}),
          ...(abortSignal !== undefined ? { signal: abortSignal } : {}),
          canUseTool: options.canUseTool,
          allowedTools: options.allowedTools,
          disallowedTools: options.disallowedTools,
        });
      } catch (error) {
        if (!(error instanceof ToolPermissionInterruptedError)) throw error;
        const message = `canUseTool interrupted the loop: ${error.message}`;
        finalText = message;
        isError = true;
        lastSubtype = "interrupted_by_can_use_tool";
        return sessionRuntime.finalize(currentResult(), lastSessionId);
      }

      const resultBlocks = toolResults.map(toolResultEntryToBlock);
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
    return sessionRuntime.finalize(currentResult(), lastSessionId);
  } finally {
    await mcpManager?.close();
  }
}
