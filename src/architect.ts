import Anthropic from "@anthropic-ai/sdk";
import { allTools, executeTool } from "./tools/index.js";
import { truncateToolResult } from "./context.js";
import type { CostTracker } from "./cost.js";

const ARCHITECT_SYSTEM = `You are an expert software architect analyzing a coding task.

Produce a detailed implementation plan:
1. List each file that needs to be created or modified
2. For each file, describe the exact changes (what to find, what to replace with)
3. Order changes by dependency (create before reference)
4. Be precise — the editor will follow your plan literally

Do NOT write actual code. Describe the changes in natural language.`;

const EDITOR_SYSTEM = `You are a precise code editor. Execute the implementation plan using the provided tools.

Rules:
- Read files before editing to get exact content for search-and-replace
- Use file_edit for modifications, file_write for new files
- Follow the plan exactly — no extra changes
- When all changes are complete, briefly confirm what was done`;

const EDITOR_TOOL_NAMES = new Set(["file_read", "file_write", "file_edit"]);
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

  const editorTools = allTools.filter((t) => EDITOR_TOOL_NAMES.has(t.name));
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
