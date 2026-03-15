import Anthropic from "@anthropic-ai/sdk";
import type { ToolResult, ToolResultBlock } from "./index.js";
import { truncateToolResult } from "../context.js";
import type { CostTracker } from "../cost.js";
import { maybeRetry } from "../tool-retry.js";
import {
  EXPLORE_PROMPT,
  EXECUTE_PROMPT,
  buildSubAgentPrompt,
  exploreTools,
  executeTools,
  exploreRunners,
  executeRunners,
} from "../delegate-prompts.js";
import {
  type CompletionReason,
  type DelegateMetadata,
  extractModifiedFiles,
  collectImageBlocks,
  assembleDelegateResult,
} from "./delegate-format.js";

export type { CompletionReason, DelegateMetadata } from "./delegate-format.js";
export { formatMetadata, buildSourcesSection, buildDelegateResult, collectImageBlocks, extractModifiedFiles } from "./delegate-format.js";

export const delegateTool: Anthropic.Tool = {
  name: "delegate",
  description:
    "Delegate a task to a sub-agent with its own context. " +
    "explore (default): read-only research. " +
    "execute: can modify files and run commands.",
  input_schema: {
    type: "object" as const,
    properties: {
      task: {
        type: "string",
        description:
          "What to do (e.g. 'find all API endpoints' or 'fix the type error in src/utils.ts')",
      },
      mode: {
        type: "string",
        enum: ["explore", "execute"],
        description: "explore (default): read-only research. execute: can modify files and run commands.",
      },
    },
    required: ["task"],
  },
};

const EXPLORE_MAX_TURNS = 10;
const EXECUTE_MAX_TURNS = 15;
const SUB_AGENT_RESULT_LIMIT = 30_000;
const IDENTICAL_FAILURE_LIMIT = 3;
const MAX_DELEGATE_IMAGES = 10;

// --- Delegate configuration (set by main session) ---

export type DelegateConfig = {
  model: string;
  client?: Anthropic;
  cwd?: string;
  projectContext?: string;
  costTracker?: CostTracker;
};

let delegateConfig: DelegateConfig = { model: "claude-sonnet-4-6" };

export function setDelegateConfig(config: DelegateConfig): void {
  delegateConfig = config;
}

// --- Main delegate runner ---

export async function runDelegate(
  input: Record<string, unknown>,
): Promise<ToolResult> {
  const task = input.task as string;
  const mode = (input.mode as string) || "explore";

  if (!task) {
    return { content: "Error: task is required", is_error: true };
  }
  if (mode !== "explore" && mode !== "execute") {
    return { content: `Error: mode must be "explore" or "execute", got "${mode}"`, is_error: true };
  }

  const isExecute = mode === "execute";
  const tools = isExecute ? executeTools : exploreTools;
  const runners = isExecute ? executeRunners : exploreRunners;
  const maxTurns = isExecute ? EXECUTE_MAX_TURNS : EXPLORE_MAX_TURNS;
  const basePrompt = isExecute ? EXECUTE_PROMPT : EXPLORE_PROMPT;
  const systemPrompt = buildSubAgentPrompt(basePrompt, delegateConfig);
  const modifiedFiles = new Set<string>();
  const collectedImages: ToolResultBlock[] = [];
  const toolsUsed = new Set<string>();
  const urlsFetched = new Set<string>();
  const searchQueries = new Set<string>();
  let completionReason: CompletionReason = "done";

  const client = delegateConfig.client ?? new Anthropic();
  const costTracker = delegateConfig.costTracker;
  const messages: Anthropic.Messages.MessageParam[] = [
    { role: "user", content: task },
  ];
  let lastText = "";
  let totalTurns = 0;

  // Failure tracking: detect stuck sub-agents
  let lastErrorSig = "";
  let identicalErrorCount = 0;

  // System prompt as cached block for prompt caching
  const systemBlocks: Anthropic.Messages.TextBlockParam[] = [
    { type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } },
  ];

  let naturalEnd = false;

  const taskPreview = task.length > 60 ? task.slice(0, 57) + "..." : task;
  console.error(`[kota] delegate(${mode}) starting: ${taskPreview}`);

  for (let turn = 0; turn < maxTurns; turn++) {
    let response: Anthropic.Message;
    try {
      const stream = client.messages.stream({
        model: delegateConfig.model,
        max_tokens: 8192,
        system: systemBlocks,
        tools,
        messages,
      });

      // Stream sub-agent text to stderr for live progress
      let lastCharNewline = true;
      stream.on("text", (delta) => {
        process.stderr.write(delta);
        lastCharNewline = delta.endsWith("\n");
      });

      response = await stream.finalMessage();
      if (!lastCharNewline) {
        process.stderr.write("\n");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("too long") || msg.includes("too many tokens") || msg.includes("context length")) {
        console.error(`[kota] delegate(${mode}) context overflow at turn ${turn + 1}`);
        completionReason = "context_overflow";
        if (lastText) break;
        return {
          content: `Sub-agent ran out of context after ${totalTurns} turns. ` +
            "The task may be too complex for a single delegation — try breaking it into smaller sub-tasks.",
          is_error: true,
        };
      }
      throw err;
    }

    totalTurns++;
    if (costTracker) costTracker.addUsage(delegateConfig.model, response.usage);

    const toolNames = response.content
      .filter((b) => b.type === "tool_use")
      .map((b) => (b as Anthropic.Messages.ToolUseBlock).name);
    for (const name of toolNames) toolsUsed.add(name);
    const toolsSummary = toolNames.length > 0 ? ` — ${toolNames.join(", ")}` : "";
    console.error(`[kota] delegate(${mode}) turn ${turn + 1}/${maxTurns}${toolsSummary}`);

    for (const block of response.content) {
      if (block.type === "text") {
        lastText = block.text;
      }
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
        const runner = runners[block.name];
        if (!runner) {
          return {
            tool_use_id: block.id,
            content: `Unknown tool: ${block.name}`,
            is_error: true as const,
          };
        }
        const toolInput = block.input as Record<string, unknown>;
        let result = await runner(toolInput);

        // Auto-retry transient failures (timeouts, network, 503s)
        if (result.is_error) {
          const retried = await maybeRetry(
            block.name, toolInput, result,
            async (_n, i) => runner(i),
          );
          if (retried) result = retried;
        }

        if (isExecute && !result.is_error) {
          for (const f of extractModifiedFiles(block.name, toolInput, result.content)) {
            modifiedFiles.add(f);
          }
        }
        if (block.name === "web_fetch" && toolInput.url) {
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

    // Collect image blocks for propagation to the main agent
    const updated = collectImageBlocks(validResults, collectedImages, MAX_DELEGATE_IMAGES);
    collectedImages.length = 0;
    collectedImages.push(...updated);

    // Failure tracking: circuit break on repeated identical errors
    const failedResults = validResults.filter((r) => r.is_error);
    if (failedResults.length > 0) {
      const sig = failedResults.map((r) => r.content).join("|");
      if (sig === lastErrorSig) {
        identicalErrorCount++;
        if (identicalErrorCount >= IDENTICAL_FAILURE_LIMIT) {
          console.error(`[kota] delegate(${mode}) circuit break — same error ${IDENTICAL_FAILURE_LIMIT}x`);
          completionReason = "circuit_break";
          lastText = (lastText ? lastText + "\n\n" : "") +
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

    // Pass rich content (images) to sub-agent so it can see its own outputs
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

  if (!naturalEnd && completionReason === "done") {
    completionReason = "turn_limit";
  }

  console.error(`[kota] delegate(${mode}) done — ${totalTurns} turn(s)`);

  const meta: DelegateMetadata = {
    mode,
    turnsUsed: totalTurns,
    turnsMax: maxTurns,
    toolsUsed: [...toolsUsed].sort(),
    completionReason,
    urlsFetched: [...urlsFetched],
    searchQueries: [...searchQueries],
  };

  return assembleDelegateResult(lastText, meta, modifiedFiles, collectedImages);
}
