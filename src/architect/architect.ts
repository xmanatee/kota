import type Anthropic from "@anthropic-ai/sdk";
import { truncateToolResult } from "../context.js";
import type { CostTracker } from "../cost.js";
import type { ModelClient } from "../model/model-client.js";
import { isRetryable } from "../model/streaming.js";
import { extractModifiedFiles } from "../tools/delegate-format.js";
import { executeTool, getAllTools } from "../tools/index.js";
import type { Transport } from "../transport.js";
import { createFailureTracker, detectReplanTrigger, invokeReplanner, recordStep } from "./replan.js";

const STREAM_MAX_RETRIES = 2;

function streamBackoff(attempt: number): Promise<void> {
  const delay = Math.min(1000 * 2 ** attempt, 8000) + Math.random() * 500;
  return new Promise((r) => setTimeout(r, delay));
}

const ARCHITECT_SYSTEM = `You are an expert planner analyzing a task.

Produce a detailed execution plan:
1. List each step with specific actions and expected outputs
2. For code: specify files, exact changes (find → replace), dependency order
3. For research: specify queries, sources to check, what to extract
4. For analysis: specify data sources, computations, visualizations
5. For writing: specify sections, key points, format
6. Be precise — the executor will follow your plan literally

Do NOT execute the plan. Describe the steps in natural language.`;

const EDITOR_SYSTEM = `You are a precise task executor. Execute the plan step-by-step using the provided tools.

Rules:
- Read files before editing to get exact content for search-and-replace
- Follow the plan exactly — no extra steps or changes
- When all steps are complete, briefly confirm what was done`;

export const EDITOR_TOOL_SET = new Set([
  "file_read", "file_write", "file_edit", "multi_edit",
  "grep", "glob",
  "web_search", "web_fetch",
  "code_exec",
  "shell",
]);
export const MAX_EDITOR_TURNS = 30;
const EDITOR_RESULT_LIMIT = 30_000;

export type ArchitectOptions = {
  client: ModelClient;
  model: string;
  maxTokens: number;
  systemContext: string;
  messages: Anthropic.Messages.MessageParam[];
  costTracker?: CostTracker;
  verbose?: boolean;
  thinking?: Anthropic.Messages.ThinkingConfigParam;
  transport?: Transport;
};

export async function runArchitectPass(opts: ArchitectOptions): Promise<string> {
  const { client, model, maxTokens, systemContext, messages, costTracker, verbose, thinking, transport } = opts;
  if (verbose && transport) transport.emit({ type: "status", message: "[kota] Architect pass — reasoning..." });

  const systemText = `${ARCHITECT_SYSTEM}\n\nProject context:\n${systemContext}`;

  for (let attempt = 0; attempt <= STREAM_MAX_RETRIES; attempt++) {
    try {
      const stream = client.messages.stream({
        model,
        max_tokens: maxTokens,
        system: [{ type: "text", text: systemText, cache_control: { type: "ephemeral" } }],
        messages,
        ...(thinking && { thinking }),
      });

      let plan = "";
      if (thinking) {
        stream.on("thinking", (delta) => {
          if (transport) transport.emit({ type: "thinking", content: delta });
        });
      }
      stream.on("text", (text) => {
        if (transport) transport.emit({ type: "progress", content: text, source: "architect" });
        plan += text;
      });

      const response = await stream.finalMessage();
      if (plan && transport) transport.emit({ type: "progress", content: "\n", source: "architect" });
      if (costTracker) costTracker.addUsage(model, response.usage);
      return plan;
    } catch (err) {
      if (attempt < STREAM_MAX_RETRIES && isRetryable(err)) {
        const msg = err instanceof Error ? err.message : String(err);
        if (transport) transport.emit({ type: "error", message: `[kota] Architect stream error (attempt ${attempt + 1}/${STREAM_MAX_RETRIES + 1}): ${msg.slice(0, 200)}` });
        await streamBackoff(attempt);
        continue;
      }
      throw err;
    }
  }
  throw new Error("unreachable");
}

export type EditorOptions = {
  client: ModelClient;
  model: string;
  maxTokens: number;
  plan: string;
  costTracker?: CostTracker;
  verbose?: boolean;
  transport?: Transport;
};

export type EditorResult = {
  text: string;
  modifiedFiles: string[];
  replans?: number;
};

export async function runEditorLoop(opts: EditorOptions): Promise<EditorResult> {
  const { client, model, maxTokens, plan, costTracker, verbose, transport } = opts;
  if (verbose && transport) transport.emit({ type: "status", message: "[kota] Editor pass — executing plan..." });

  const editorTools = getAllTools().filter((t) => EDITOR_TOOL_SET.has(t.name));
  const systemBlocks: Anthropic.Messages.TextBlockParam[] = [
    { type: "text", text: EDITOR_SYSTEM, cache_control: { type: "ephemeral" } },
  ];
  const messages: Anthropic.Messages.MessageParam[] = [
    { role: "user", content: plan },
  ];
  let lastText = "";
  const modifiedFiles = new Set<string>();
  let completedNaturally = false;
  const tracker = createFailureTracker();

  for (let turn = 0; turn < MAX_EDITOR_TURNS; turn++) {
    let response!: Anthropic.Message;
    let streamSuccess = false;
    for (let attempt = 0; attempt <= STREAM_MAX_RETRIES; attempt++) {
      try {
        const stream = client.messages.stream({
          model,
          max_tokens: maxTokens,
          system: systemBlocks,
          tools: editorTools,
          messages,
        });

        let text = "";
        stream.on("text", (t) => {
          if (transport) transport.emit({ type: "text", content: t });
          text += t;
        });

        response = await stream.finalMessage();
        if (text) {
          if (transport) transport.emit({ type: "text", content: "\n" });
          lastText = text;
        }
        streamSuccess = true;
        break;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("too long") || msg.includes("too many tokens") || msg.includes("context length")) {
          if (transport) transport.emit({ type: "error", message: `[kota] Editor context overflow at turn ${turn + 1}` });
          break;
        }
        if (attempt < STREAM_MAX_RETRIES && isRetryable(err)) {
          if (transport) transport.emit({ type: "error", message: `[kota] Editor stream error (attempt ${attempt + 1}/${STREAM_MAX_RETRIES + 1}): ${msg.slice(0, 200)}` });
          await streamBackoff(attempt);
          continue;
        }
        throw err;
      }
    }
    if (!streamSuccess) { completedNaturally = true; break; }

    if (costTracker) costTracker.addUsage(model, response.usage);
    if (verbose && transport) transport.emit({ type: "status", message: `[kota] Editor turn ${turn + 1}/${MAX_EDITOR_TURNS}` });

    messages.push({ role: "assistant", content: response.content });

    const toolBlocks = response.content.filter((b) => b.type === "tool_use");
    if (toolBlocks.length === 0) { completedNaturally = true; break; }

    const results = await Promise.all(
      toolBlocks.map(async (block) => {
        if (block.type !== "tool_use") return null;
        if (verbose && transport) {
          transport.emit({ type: "status", message: `[kota] Editor: ${block.name}(${JSON.stringify(block.input).slice(0, 80)})` });
        }
        const result = await executeTool(
          block.name,
          block.input as Record<string, unknown>,
        );
        return {
          tool_use_id: block.id,
          name: block.name,
          content: truncateToolResult(result.content, EDITOR_RESULT_LIMIT),
          is_error: result.is_error,
        };
      }),
    );

    const filtered = results.filter((r): r is NonNullable<typeof r> => r !== null);

    for (const block of toolBlocks) {
      if (block.type !== "tool_use") continue;
      const res = filtered.find((r) => r.tool_use_id === block.id);
      if (res && !res.is_error) {
        for (const f of extractModifiedFiles(block.name, block.input as Record<string, unknown>, res.content)) {
          modifiedFiles.add(f);
        }
      }
    }

    // Record steps for failure tracking
    for (const res of filtered) {
      recordStep(tracker, {
        tool: res.name,
        error: res.is_error ? res.content : null,
      });
    }

    messages.push({
      role: "user",
      content: filtered.map((r) => ({
        type: "tool_result" as const,
        tool_use_id: r.tool_use_id,
        content: r.content,
        is_error: r.is_error,
      })),
    });

    // Check for replan trigger
    const trigger = detectReplanTrigger(tracker);
    if (trigger) {
      if (transport) transport.emit({ type: "status", message: `[kota] Replanning (${trigger})...` });
      const decision = await invokeReplanner({
        client, model, maxTokens, originalPlan: plan, messages, trigger, costTracker,
      });

      if (decision.action === "abort") {
        if (transport) transport.emit({ type: "error", message: `[kota] Plan aborted: ${decision.reason}` });
        lastText = `Plan aborted: ${decision.reason}`;
        completedNaturally = true;
        break;
      }

      if (decision.action === "revise") {
        if (transport) transport.emit({ type: "status", message: "[kota] Plan revised — continuing execution..." });
        messages.push({
          role: "user",
          content: `[Plan revised] The previous approach encountered issues. Here is the revised plan for remaining work:\n\n${decision.plan}\n\nContinue executing from here. Previous successful results are still valid.`,
        });
      }

      tracker.replanCount++;
      tracker.consecutiveErrors = 0;
      tracker.recentErrors = [];
    }
  }

  if (!completedNaturally && transport) {
    transport.emit({ type: "error", message: `[kota] Editor hit turn limit (${MAX_EDITOR_TURNS}) — execution may be incomplete` });
  }

  return {
    text: lastText,
    modifiedFiles: [...modifiedFiles],
    ...(tracker.replanCount > 0 && { replans: tracker.replanCount }),
  };
}
