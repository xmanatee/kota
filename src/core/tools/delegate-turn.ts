import type Anthropic from "@anthropic-ai/sdk";
import type { KotaTool } from "#core/agent-harness/message-protocol.js";
import { truncateToolResult } from "#core/loop/context.js";
import type { CostTracker } from "#core/loop/cost.js";
import type { Transport } from "#core/loop/transport.js";
import type { McpManager } from "#core/mcp/manager.js";
import type { ModelClient } from "#core/model/model-client.js";
import { isRetryable } from "#core/model/streaming.js";
import type { DelegateMode } from "./delegate-config.js";
import {
  IDENTICAL_FAILURE_LIMIT,
  MAX_DELEGATE_IMAGES,
  STREAM_MAX_RETRIES,
  SUB_AGENT_RESULT_LIMIT,
  streamBackoff,
} from "./delegate-config.js";
import type { CompletionReason } from "./delegate-format.js";
import { collectImageBlocks, extractModifiedFiles } from "./delegate-format.js";
import type { ToolResult, ToolResultBlock } from "./index.js";
import { getToolMiddleware } from "./tool-middleware.js";

export type TurnLoopOptions = {
  client: ModelClient;
  messages: Anthropic.Messages.MessageParam[];
  systemBlocks: Anthropic.Messages.TextBlockParam[];
  tools: KotaTool[];
  runners: Record<string, (input: Record<string, unknown>) => Promise<ToolResult>>;
  mcpMgr: McpManager | undefined;
  isExecute: boolean;
  selectedModel: string;
  maxTurns: number;
  mode: DelegateMode;
  transport: Transport | undefined;
  costTracker: CostTracker | undefined;
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
    client, messages, systemBlocks, tools, runners, mcpMgr, isExecute,
    selectedModel, maxTurns, mode, transport, costTracker,
    modifiedFiles, collectedImages, toolsUsed, urlsFetched, searchQueries,
  } = opts;

  let lastText = "";
  let totalTurns = 0;
  let lastErrorSig = "";
  let identicalErrorCount = 0;
  let naturalEnd = false;
  let completionReason: CompletionReason = "done";

  for (let turn = 0; turn < maxTurns; turn++) {
    let response!: Anthropic.Message;
    let streamSuccess = false;
    for (let attempt = 0; attempt <= STREAM_MAX_RETRIES; attempt++) {
      try {
        const stream = client.messages.stream({
          model: selectedModel,
          max_tokens: 8192,
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

    const toolNames = response.content
      .filter((b) => b.type === "tool_use")
      .map((b) => (b as Anthropic.Messages.ToolUseBlock).name);
    for (const name of toolNames) toolsUsed.add(name);
    const toolsSummary = toolNames.length > 0 ? ` — ${toolNames.join(", ")}` : "";
    if (transport) transport.emit({ type: "status", message: `[kota] delegate(${mode}) turn ${turn + 1}/${maxTurns}${toolsSummary}` });
    if (transport && (mode === "explore" || mode === "research") && toolNames.length > 0) {
      const { getToolKind } = await import("./index.js");
      const unexpected = toolNames.filter((n) => getToolKind(n) === "action");
      if (unexpected.length > 0) {
        transport.emit({ type: "status", message: `[kota] delegate(${mode}) action tool(s) in exploration phase: ${unexpected.join(", ")}` });
      }
    }

    for (const block of response.content) {
      if (block.type === "text") lastText = block.text;
    }

    messages.push({ role: "assistant", content: response.content });

    const toolBlocks = response.content.filter((b) => b.type === "tool_use");
    if (toolBlocks.length === 0) {
      naturalEnd = true;
      break;
    }

    const results = await Promise.all(
      toolBlocks.map(async (block) => {
        if (block.type !== "tool_use") return null;
        const toolInput = block.input as Record<string, unknown>;

        const isMcp = mcpMgr?.isMcpTool(block.name);
        const runner = isMcp ? undefined : runners[block.name];
        if (!runner && !isMcp) {
          return { tool_use_id: block.id, content: `Unknown tool: ${block.name}`, is_error: true as const };
        }
        let result: ToolResult;
        const call = { name: block.name, input: toolInput };
        try {
          result = await getToolMiddleware().execute(call, () =>
            isMcp
              ? mcpMgr!.executeTool(block.name, call.input)
              : runner!(call.input)
          );
        } catch (runnerErr) {
          const errMsg = runnerErr instanceof Error ? runnerErr.message : String(runnerErr);
          result = { content: `Tool error (${block.name}): ${errMsg}`, is_error: true };
        }

        if (isExecute && !result.is_error) {
          for (const f of extractModifiedFiles(block.name, toolInput, result.content)) {
            modifiedFiles.add(f);
          }
        }
        if ((block.name === "web_fetch" || block.name === "http_request") && toolInput.url) {
          urlsFetched.add(toolInput.url as string);
        }
        if (block.name === "web_search" && toolInput.query) {
          searchQueries.add(toolInput.query as string);
        }

        return {
          tool_use_id: block.id,
          content: truncateToolResult(result.content, SUB_AGENT_RESULT_LIMIT),
          blocks: result.blocks,
          is_error: result.is_error,
        };
      }),
    );

    const validResults = results.filter((r): r is NonNullable<typeof r> => r !== null);

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
          ? (r.blocks as Anthropic.Messages.ToolResultBlockParam["content"])
          : r.content,
        is_error: r.is_error,
      })),
    });
  }

  return { naturalEnd, completionReason, lastText, totalTurns };
}
