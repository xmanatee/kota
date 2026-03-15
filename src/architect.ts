import Anthropic from "@anthropic-ai/sdk";
import { allTools, executeTool } from "./tools/index.js";
import { truncateToolResult } from "./context.js";
import type { CostTracker } from "./cost.js";
import { filterTools } from "./tool-groups.js";

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
};

export async function runArchitectPass(opts: ArchitectOptions): Promise<string> {
  const { client, model, maxTokens, systemContext, messages, costTracker, verbose, thinking } = opts;
  if (verbose) console.error("[kota] Architect pass — reasoning...");

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
      if (verbose) process.stderr.write(delta);
    });
  }
  stream.on("text", (text) => {
    process.stderr.write(text);
    plan += text;
  });

  const response = await stream.finalMessage();
  if (plan) process.stderr.write("\n");
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
};

export async function runEditorLoop(opts: EditorOptions): Promise<string> {
  const { client, model, maxTokens, plan, costTracker, verbose } = opts;
  if (verbose) console.error("[kota] Editor pass — executing plan...");

  const editorTools = filterTools(allTools).filter((t) => EDITOR_TOOL_SET.has(t.name));
  const systemBlocks: Anthropic.Messages.TextBlockParam[] = [
    { type: "text", text: EDITOR_SYSTEM, cache_control: { type: "ephemeral" } },
  ];
  const messages: Anthropic.Messages.MessageParam[] = [
    { role: "user", content: plan },
  ];
  let lastText = "";

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
        process.stdout.write(t);
        text += t;
      });

      response = await stream.finalMessage();
      if (text) {
        process.stdout.write("\n");
        lastText = text;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("too long") || msg.includes("too many tokens") || msg.includes("context length")) {
        console.error(`[kota] Editor context overflow at turn ${turn + 1}`);
        break;
      }
      throw err;
    }

    if (costTracker) costTracker.addUsage(model, response.usage);
    if (verbose) console.error(`[kota] Editor turn ${turn + 1}/${MAX_EDITOR_TURNS}`);

    messages.push({ role: "assistant", content: response.content });

    const toolBlocks = response.content.filter((b) => b.type === "tool_use");
    if (toolBlocks.length === 0) break;

    const results = await Promise.all(
      toolBlocks.map(async (block) => {
        if (block.type !== "tool_use") return null;
        if (verbose) {
          console.error(
            `[kota] Editor: ${block.name}(${JSON.stringify(block.input).slice(0, 80)})`,
          );
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

    messages.push({
      role: "user",
      content: results
        .filter((r): r is NonNullable<typeof r> => r !== null)
        .map((r) => ({
          type: "tool_result" as const,
          tool_use_id: r.tool_use_id,
          content: r.content,
          is_error: r.is_error,
        })),
    });
  }

  return lastText;
}
