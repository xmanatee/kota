import Anthropic from "@anthropic-ai/sdk";
import { allTools, executeTool } from "./tools/index.js";
import { truncateToolResult } from "./context.js";
import type { CostTracker } from "./cost.js";
import type { Transport } from "./transport.js";

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
  client: Anthropic;
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
}

export type EditorOptions = {
  client: Anthropic;
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
};

const EDIT_TOOL_NAMES = new Set(["file_edit", "file_write", "multi_edit"]);

export async function runEditorLoop(opts: EditorOptions): Promise<EditorResult> {
  const { client, model, maxTokens, plan, costTracker, verbose, transport } = opts;
  if (verbose && transport) transport.emit({ type: "status", message: "[kota] Editor pass — executing plan..." });

  const editorTools = allTools.filter((t) => EDITOR_TOOL_SET.has(t.name));
  const systemBlocks: Anthropic.Messages.TextBlockParam[] = [
    { type: "text", text: EDITOR_SYSTEM, cache_control: { type: "ephemeral" } },
  ];
  const messages: Anthropic.Messages.MessageParam[] = [
    { role: "user", content: plan },
  ];
  let lastText = "";
  const modifiedFiles = new Set<string>();

  for (let turn = 0; turn < MAX_EDITOR_TURNS; turn++) {
    let response: Anthropic.Message;
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
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("too long") || msg.includes("too many tokens") || msg.includes("context length")) {
        if (transport) transport.emit({ type: "error", message: `[kota] Editor context overflow at turn ${turn + 1}` });
        break;
      }
      throw err;
    }

    if (costTracker) costTracker.addUsage(model, response.usage);
    if (verbose && transport) transport.emit({ type: "status", message: `[kota] Editor turn ${turn + 1}/${MAX_EDITOR_TURNS}` });

    messages.push({ role: "assistant", content: response.content });

    const toolBlocks = response.content.filter((b) => b.type === "tool_use");
    if (toolBlocks.length === 0) break;

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
          content: truncateToolResult(result.content, EDITOR_RESULT_LIMIT),
          is_error: result.is_error,
        };
      }),
    );

    const filtered = results.filter((r): r is NonNullable<typeof r> => r !== null);

    // Track modified files from successful edit tool calls
    for (const block of toolBlocks) {
      if (block.type !== "tool_use") continue;
      const res = filtered.find((r) => r.tool_use_id === block.id);
      if (res && !res.is_error && EDIT_TOOL_NAMES.has(block.name)) {
        const input = block.input as Record<string, unknown>;
        if (block.name === "multi_edit") {
          const edits = input.edits as Array<{ file_path?: string }> | undefined;
          if (edits) for (const e of edits) { if (e.file_path) modifiedFiles.add(e.file_path); }
        } else {
          const p = (input.path as string) || "";
          if (p) modifiedFiles.add(p);
        }
      }
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
  }

  return { text: lastText, modifiedFiles: [...modifiedFiles] };
}
