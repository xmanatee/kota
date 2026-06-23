import type {
  KotaMessage,
  KotaModelResponse,
  KotaTextBlock,
  KotaTool,
  KotaToolResultBlockContent,
  KotaToolUseBlock,
} from "#core/agent-harness/message-protocol.js";
import {
  type AgentTokenBudgetLedger,
  agentTokenUsageFromModelUsage,
} from "#core/agent-harness/token-budget.js";
import type { CostTracker } from "#core/loop/cost.js";
import type { Transport } from "#core/loop/transport.js";
import type { McpManager } from "#core/mcp/manager.js";
import type { ModelClient } from "#core/model/model-client.js";
import {
  type ModelOutputTokenLimits,
  resolveModelOutputTokenLimit,
} from "#core/model/output-token-limits.js";
import { isRetryable } from "#core/model/streaming.js";
import type { DelegateMode } from "./delegate-config.js";
import {
  IDENTICAL_FAILURE_LIMIT,
  MAX_DELEGATE_IMAGES,
  STREAM_MAX_RETRIES,
  streamBackoff,
} from "./delegate-config.js";
import type { CompletionReason } from "./delegate-format.js";
import { collectImageBlocks } from "./delegate-format.js";
import {
  delegateTokenBudgetSource,
  tokenBudgetEarlyError,
} from "./delegate-turn-token-budget.js";
import { executeDelegateToolBlocks } from "./delegate-turn-tools.js";
import type {
  ToolResultBlock,
  ToolRunner,
  ToolRunnerContext,
} from "./index.js";

export type TurnLoopOptions = {
  client: ModelClient;
  messages: KotaMessage[];
  systemBlocks: KotaTextBlock[];
  tools: KotaTool[];
  runners: Record<string, ToolRunner>;
  runnerContext?: ToolRunnerContext;
  mcpMgr: McpManager | undefined;
  isExecute: boolean;
  selectedModel: string;
  modelOutputTokenLimits: ModelOutputTokenLimits | undefined;
  maxTurns: number;
  mode: DelegateMode;
  transport: Transport | undefined;
  costTracker: CostTracker | undefined;
  tokenBudget?: AgentTokenBudgetLedger;
  modifiedFiles: Set<string>;
  collectedImages: ToolResultBlock[];
  toolsUsed: Set<string>;
  urlsFetched: Set<string>;
  searchQueries: Set<string>;
};

export type TurnLoopResult = {
  earlyError?: { content: string; is_error: true };
  naturalEnd: boolean;
  completionReason: CompletionReason;
  lastText: string;
  totalTurns: number;
};

export async function runDelegateTurns(opts: TurnLoopOptions): Promise<TurnLoopResult> {
  const {
    client, messages, systemBlocks, tools, runners, runnerContext, mcpMgr, isExecute,
    selectedModel, modelOutputTokenLimits, maxTurns, mode, transport, costTracker,
    tokenBudget, modifiedFiles, collectedImages, toolsUsed, urlsFetched, searchQueries,
  } = opts;
  const outputTokenLimit = resolveModelOutputTokenLimit(
    selectedModel,
    modelOutputTokenLimits,
  );

  let lastText = "";
  let totalTurns = 0;
  let lastErrorSig = "";
  let identicalErrorCount = 0;
  let naturalEnd = false;
  let completionReason: CompletionReason = "done";

  for (let turn = 0; turn < maxTurns; turn++) {
    const source = delegateTokenBudgetSource(selectedModel, turn + 1);
    const exhaustion = tokenBudget?.checkCanStartTurn(source);
    if (exhaustion) {
      return tokenBudgetEarlyError(exhaustion.message, lastText, totalTurns);
    }

    let response!: KotaModelResponse;
    let streamSuccess = false;
    for (let attempt = 0; attempt <= STREAM_MAX_RETRIES; attempt++) {
      try {
        const stream = client.messages.stream({
          model: selectedModel,
          max_tokens: outputTokenLimit.maxTokens,
          system: systemBlocks,
          tools,
          messages,
        });

        let lastCharNewline = true;
        stream.on("text", (delta) => {
          if (transport) transport.emit({ type: "progress", content: delta, source: `delegate(${mode})` });
          lastCharNewline = delta.endsWith("\n");
        });

        response = await stream.finalMessage();
        if (!lastCharNewline && transport) {
          transport.emit({ type: "progress", content: "\n", source: `delegate(${mode})` });
        }
        streamSuccess = true;
        break;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("too long") || msg.includes("too many tokens") || msg.includes("context length")) {
          if (transport) transport.emit({ type: "error", message: `[kota] delegate(${mode}) context overflow at turn ${turn + 1}` });
          completionReason = "context_overflow";
          if (lastText) break;
          return {
            earlyError: {
              content: `Sub-agent ran out of context after ${totalTurns} turns. ` +
                "The task may be too complex for a single delegation — try breaking it into smaller sub-tasks.",
              is_error: true,
            },
            naturalEnd: false,
            completionReason: "context_overflow",
            lastText: "",
            totalTurns,
          };
        }
        if (attempt < STREAM_MAX_RETRIES && isRetryable(err)) {
          if (transport) transport.emit({ type: "error", message: `[kota] delegate(${mode}) stream error (attempt ${attempt + 1}/${STREAM_MAX_RETRIES + 1}): ${msg.slice(0, 200)}` });
          await streamBackoff(attempt);
          continue;
        }
        return {
          earlyError: {
            content: `Sub-agent API error after ${totalTurns} turn(s): ${msg.slice(0, 300)}`,
            is_error: true,
          },
          naturalEnd: false,
          completionReason: "done",
          lastText: "",
          totalTurns,
        };
      }
    }
    if (!streamSuccess) break;

    totalTurns++;
    if (costTracker) costTracker.addUsage(selectedModel, response.usage);
    tokenBudget?.debitUsage(agentTokenUsageFromModelUsage(response.usage), source);

    const toolBlocks = response.content.filter(
      (b): b is KotaToolUseBlock => b.type === "tool_use",
    );
    const toolNames = toolBlocks.map((b) => b.name);
    for (const name of toolNames) toolsUsed.add(name);
    const toolsSummary = toolNames.length > 0 ? ` — ${toolNames.join(", ")}` : "";
    if (transport) transport.emit({ type: "status", message: `[kota] delegate(${mode}) turn ${turn + 1}/${maxTurns}${toolsSummary}` });
    if (transport && (mode === "explore" || mode === "research") && toolNames.length > 0) {
      const { getToolEffect } = await import("./index.js");
      const unexpected = toolNames.filter((n) => {
        const effect = getToolEffect(n);
        return effect ? effect.kind !== "read" : false;
      });
      if (unexpected.length > 0) {
        transport.emit({ type: "status", message: `[kota] delegate(${mode}) action tool(s) in exploration phase: ${unexpected.join(", ")}` });
      }
    }

    for (const block of response.content) {
      if (block.type === "text") lastText = block.text;
    }

    messages.push({
      role: "assistant",
      content: response.content,
    });

    const turnExhaustion = tokenBudget?.checkAfterDebit(source);
    if (turnExhaustion) {
      return tokenBudgetEarlyError(
        toolBlocks.length > 0
          ? `${turnExhaustion.message} Tool calls were not executed because the child cannot continue to consume their results.`
          : turnExhaustion.message,
        lastText,
        totalTurns,
      );
    }

    if (toolBlocks.length === 0) {
      naturalEnd = true;
      break;
    }

    const validResults = await executeDelegateToolBlocks({
      toolBlocks,
      runners,
      runnerContext,
      mcpMgr,
      isExecute,
      modifiedFiles,
      urlsFetched,
      searchQueries,
    });

    const updated = collectImageBlocks(validResults, collectedImages, MAX_DELEGATE_IMAGES);
    collectedImages.length = 0;
    collectedImages.push(...updated);

    const failedResults = validResults.filter((r) => r.is_error);
    if (failedResults.length > 0) {
      const sig = failedResults.map((r) => r.content).join("|");
      if (sig === lastErrorSig) {
        identicalErrorCount++;
        if (identicalErrorCount >= IDENTICAL_FAILURE_LIMIT) {
          if (transport) transport.emit({ type: "error", message: `[kota] delegate(${mode}) circuit break — same error ${IDENTICAL_FAILURE_LIMIT}x` });
          completionReason = "circuit_break";
          lastText = (lastText ? `${lastText}\n\n` : "") +
            `Sub-agent stopped: repeated the same failing operation ${IDENTICAL_FAILURE_LIMIT} times. ` +
            `Last error: ${failedResults[0].content.slice(0, 200)}`;
          break;
        }
      } else {
        identicalErrorCount = 1;
        lastErrorSig = sig;
      }
    } else {
      identicalErrorCount = 0;
      lastErrorSig = "";
    }

    messages.push({
      role: "user",
      content: validResults.map((r) => ({
        type: "tool_result" as const,
        tool_use_id: r.tool_use_id,
        content: r.blocks
          ? (r.blocks as KotaToolResultBlockContent)
          : r.content,
        ...(r.structuredContent ? { structuredContent: r.structuredContent } : {}),
        ...(r._meta ? { _meta: r._meta } : {}),
        ...(r.is_error !== undefined ? { is_error: r.is_error } : {}),
      })),
    });
  }

  return { naturalEnd, completionReason, lastText, totalTurns };
}
