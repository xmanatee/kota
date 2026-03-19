import type Anthropic from "@anthropic-ai/sdk";
import { truncateToolResult } from "../context.js";
import type { CostTracker } from "../cost.js";
import {
  buildSubAgentPrompt,
  EXECUTE_PROMPT,
  EXPLORE_PROMPT,
  executeRunners,
  executeTools,
  exploreRunners,
  exploreTools,
  RESEARCH_PROMPT,
  researchRunners,
  researchTools,
} from "../delegate-prompts.js";
import type { McpManager } from "../mcp/manager.js";
import { AnthropicModelClient, type ModelClient } from "../model/model-client.js";
import type { DelegateBackend, ModelTiers } from "../model/model-router.js";
import { routeModel } from "../model/model-router.js";
import { isRetryable } from "../model/streaming.js";
import { maybeRetry } from "../tool-retry.js";
import type { Transport } from "../transport.js";
import {
  assembleDelegateResult,
  type CompletionReason,
  collectImageBlocks,
  type DelegateMetadata,
  extractModifiedFiles,
} from "./delegate-format.js";
import type { ToolResult, ToolResultBlock } from "./index.js";
import { PromptStore } from "./prompt-template.js";

export type { CompletionReason, DelegateMetadata } from "./delegate-format.js";
export { buildDelegateResult, buildSourcesSection, collectImageBlocks, extractModifiedFiles, formatMetadata } from "./delegate-format.js";

export type DelegateMode = "explore" | "execute" | "research";

export const delegateTool: Anthropic.Tool = {
  name: "delegate",
  description:
    "Delegate a task to a sub-agent with its own context. " +
    "explore (default): read-only research. " +
    "execute: can modify files and run commands. " +
    "research: deep multi-step research with iterative search and source tracking. " +
    "Use 'prompt' to override the sub-agent's system prompt with a template from .kota/prompts/.",
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
        enum: ["explore", "execute", "research"],
        description: "explore (default): read-only. execute: can modify files. research: deep multi-step research with iterative search.",
      },
      prompt: {
        type: "string",
        description: "Name of a prompt template from .kota/prompts/ to use as the sub-agent system prompt (overrides default mode prompt).",
      },
      prompt_vars: {
        type: "object",
        description: "Variables to substitute in the prompt template (e.g. {\"language\": \"TypeScript\"}).",
      },
    },
    required: ["task"],
  },
};

const EXPLORE_MAX_TURNS = 10;
const EXECUTE_MAX_TURNS = 15;
const RESEARCH_MAX_TURNS = 25;
const SUB_AGENT_RESULT_LIMIT = 30_000;
const IDENTICAL_FAILURE_LIMIT = 3;
const MAX_DELEGATE_IMAGES = 10;
const STREAM_MAX_RETRIES = 2;

function streamBackoff(attempt: number): Promise<void> {
  const delay = Math.min(1000 * 2 ** attempt, 8000) + Math.random() * 500;
  return new Promise((r) => setTimeout(r, delay));
}

// --- Delegate configuration (set by main session) ---

export type DelegateConfig = {
  model: string;
  modelTiers?: ModelTiers;
  client?: ModelClient;
  cwd?: string;
  projectContext?: string;
  instructionContext?: string;
  costTracker?: CostTracker;
  transport?: Transport;
  mcpManager?: McpManager;
  /** Override backend selection: "thin" (default KOTA loop) or "agent-sdk" (Claude Code runtime). */
  backend?: DelegateBackend;
  /** Budget cap in USD for Agent SDK delegations. */
  agentSdkBudgetUsd?: number;
};

let delegateConfig: DelegateConfig = { model: "claude-sonnet-4-6" };

export function setDelegateConfig(config: DelegateConfig): void {
  delegateConfig = config;
}

// --- Prompt template resolution ---

function resolvePromptTemplate(
  name: string,
  vars: Record<string, string>,
  cwd?: string,
): { content?: string; error?: string } {
  const store = new PromptStore(cwd || process.cwd());
  store.discover();
  const tpl = store.get(name);
  if (!tpl) {
    const available = store.list();
    const hint = available.length > 0
      ? ` Available: ${available.map((t) => t.name).join(", ")}`
      : " No templates found in .kota/prompts/.";
    return { error: `Error: prompt template "${name}" not found.${hint}` };
  }
  const result = store.render(name, vars);
  if (!result) return { error: `Error: failed to render template "${name}".` };
  const warn = result.missing.length > 0
    ? `\n\nNote: unresolved template variables: ${result.missing.join(", ")}`
    : "";
  return { content: result.content + warn };
}

// --- Main delegate runner ---

export async function runDelegate(
  input: Record<string, unknown>,
): Promise<ToolResult> {
  const task = input.task as string;
  const rawMode = (input.mode as string) || "explore";

  if (!task || (typeof task === "string" && !task.trim())) {
    return { content: "Error: task is required", is_error: true };
  }
  const VALID_MODES: Set<DelegateMode> = new Set(["explore", "execute", "research"]);
  if (!VALID_MODES.has(rawMode as DelegateMode)) {
    return { content: `Error: mode must be "explore", "execute", or "research", got "${rawMode}"`, is_error: true };
  }
  const mode: DelegateMode = rawMode as DelegateMode;

  const isExecute = mode === "execute";

  // Adaptive model selection: route to appropriate tier based on task complexity
  const modelRoute = delegateConfig.modelTiers
    ? routeModel(task, mode, delegateConfig.modelTiers, delegateConfig.model)
    : null;
  const selectedModel = modelRoute?.model ?? delegateConfig.model;

  // Route to Agent SDK backend if configured or auto-selected
  const resolvedBackend = delegateConfig.backend ?? modelRoute?.backend ?? "thin";
  if (resolvedBackend === "agent-sdk") {
    const { runDelegateAgentSDK } = await import("./delegate-agent-sdk.js");
    return runDelegateAgentSDK(task, mode, {
      cwd: delegateConfig.cwd,
      projectContext: delegateConfig.projectContext,
      instructionContext: delegateConfig.instructionContext,
      costTracker: delegateConfig.costTracker,
      transport: delegateConfig.transport,
      maxBudgetUsd: delegateConfig.agentSdkBudgetUsd,
      model: selectedModel,
    });
  }

  const TOOLS_BY_MODE = { explore: exploreTools, execute: executeTools, research: researchTools } as const;
  const RUNNERS_BY_MODE = { explore: exploreRunners, execute: executeRunners, research: researchRunners } as const;
  const TURNS_BY_MODE = { explore: EXPLORE_MAX_TURNS, execute: EXECUTE_MAX_TURNS, research: RESEARCH_MAX_TURNS } as const;
  const PROMPT_BY_MODE = { explore: EXPLORE_PROMPT, execute: EXECUTE_PROMPT, research: RESEARCH_PROMPT } as const;

  const builtinTools = TOOLS_BY_MODE[mode as DelegateMode];
  const runners = RUNNERS_BY_MODE[mode as DelegateMode];

  // Include MCP tools so sub-agents can use external tool servers
  const mcpMgr = delegateConfig.mcpManager;
  const mcpTools = mcpMgr ? mcpMgr.getTools() : [];
  const tools = mcpTools.length > 0 ? [...builtinTools, ...mcpTools] : builtinTools;
  const maxTurns = TURNS_BY_MODE[mode as DelegateMode];

  // Resolve prompt: custom template or default mode prompt
  const promptName = input.prompt as string | undefined;
  const promptVars = (input.prompt_vars as Record<string, string>) || {};
  let basePrompt: string;
  if (promptName) {
    const resolved = resolvePromptTemplate(promptName, promptVars, delegateConfig.cwd);
    if (resolved.error) return { content: resolved.error, is_error: true };
    basePrompt = resolved.content!;
  } else {
    basePrompt = PROMPT_BY_MODE[mode as DelegateMode];
  }
  const systemPrompt = buildSubAgentPrompt(basePrompt, delegateConfig);
  const modifiedFiles = new Set<string>();
  const collectedImages: ToolResultBlock[] = [];
  const toolsUsed = new Set<string>();
  const urlsFetched = new Set<string>();
  const searchQueries = new Set<string>();
  let completionReason: CompletionReason = "done";

  const client = delegateConfig.client ?? new AnthropicModelClient();
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

  const transport = delegateConfig.transport;
  const taskChars = [...task];
  const taskPreview = taskChars.length > 60 ? `${taskChars.slice(0, 57).join("")}...` : task;
  const routeInfo = modelRoute ? ` [${modelRoute.tier}:${selectedModel}]` : "";
  if (transport) transport.emit({ type: "status", message: `[kota] delegate(${mode})${routeInfo} starting: ${taskPreview}` });

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
            content: `Sub-agent ran out of context after ${totalTurns} turns. ` +
              "The task may be too complex for a single delegation — try breaking it into smaller sub-tasks.",
            is_error: true,
          };
        }
        if (attempt < STREAM_MAX_RETRIES && isRetryable(err)) {
          if (transport) transport.emit({ type: "error", message: `[kota] delegate(${mode}) stream error (attempt ${attempt + 1}/${STREAM_MAX_RETRIES + 1}): ${msg.slice(0, 200)}` });
          await streamBackoff(attempt);
          continue;
        }
        return {
          content: `Sub-agent API error after ${totalTurns} turn(s): ${msg.slice(0, 300)}`,
          is_error: true,
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
      // Dynamic import avoids circular module evaluation (index.ts imports delegate.ts).
      const { getToolKind } = await import("./index.js");
      const unexpected = toolNames.filter((n) => getToolKind(n) === "action");
      if (unexpected.length > 0) {
        transport.emit({ type: "status", message: `[kota] delegate(${mode}) action tool(s) in exploration phase: ${unexpected.join(", ")}` });
      }
    }

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
        const toolInput = block.input as Record<string, unknown>;

        // Route MCP tools through the manager, built-in tools through runners
        const isMcp = mcpMgr?.isMcpTool(block.name);
        const runner = isMcp ? undefined : runners[block.name];
        if (!runner && !isMcp) {
          return {
            tool_use_id: block.id,
            content: `Unknown tool: ${block.name}`,
            is_error: true as const,
          };
        }
        let result: ToolResult;
        try {
          result = isMcp
            ? await mcpMgr!.executeTool(block.name, toolInput)
            : await runner!(toolInput);
        } catch (runnerErr) {
          const errMsg = runnerErr instanceof Error ? runnerErr.message : String(runnerErr);
          result = { content: `Tool error (${block.name}): ${errMsg}`, is_error: true };
        }

        // Auto-retry transient failures (timeouts, network, 503s)
        if (result.is_error) {
          const executor = isMcp
            ? async (_n: string, i: Record<string, unknown>) => mcpMgr!.executeTool(block.name, i)
            : async (_n: string, i: Record<string, unknown>) => runner!(i);
          const retried = await maybeRetry(block.name, toolInput, result, executor);
          if (retried) result = retried;
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

  if (transport) transport.emit({ type: "status", message: `[kota] delegate(${mode}) done — ${totalTurns} turn(s)` });

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
export const registration = {
	tool: delegateTool,
	runner: runDelegate,
	risk: "moderate" as const,
	kind: "action" as const,
};
