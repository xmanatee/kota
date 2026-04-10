import type Anthropic from "@anthropic-ai/sdk";
import { truncateToolResult } from "../core/loop/context.js";
import type { CostTracker } from "../core/loop/cost.js";
import type { ModelClient } from "../model/model-client.js";
import { isRetryable } from "../model/streaming.js";
import { extractModifiedFiles } from "../core/tools/delegate-format.js";
import { executeTool, getAllTools } from "../core/tools/index.js";
import type { Transport } from "../core/loop/transport.js";
import { createFailureTracker, detectReplanTrigger, invokeReplanner, recordStep } from "./replan.js";
import { STREAM_MAX_RETRIES, streamBackoff } from "./retry.js";

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
