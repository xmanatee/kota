import Anthropic from "@anthropic-ai/sdk";
import { allTools, executeTool } from "./tools/index.js";

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
const MAX_EDITOR_TURNS = 30;

export async function runArchitectPass(
  client: Anthropic,
  model: string,
  maxTokens: number,
  systemContext: string,
  messages: Anthropic.Messages.MessageParam[],
  verbose: boolean,
  thinking?: Anthropic.Messages.ThinkingConfigParam,
): Promise<string> {
  if (verbose) console.error("[kota] Architect pass — reasoning...");

  const stream = client.messages.stream({
    model,
    max_tokens: maxTokens,
    system: `${ARCHITECT_SYSTEM}\n\nProject context:\n${systemContext}`,
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

  await stream.finalMessage();
  if (plan) process.stderr.write("\n");
  return plan;
}

export async function runEditorLoop(
  client: Anthropic,
  model: string,
  maxTokens: number,
  plan: string,
  verbose: boolean,
): Promise<string> {
  if (verbose) console.error("[kota] Editor pass — executing plan...");

  const editorTools = allTools.filter((t) => EDITOR_TOOL_NAMES.has(t.name));
  const messages: Anthropic.Messages.MessageParam[] = [
    { role: "user", content: plan },
  ];
  let lastText = "";

  for (let turn = 0; turn < MAX_EDITOR_TURNS; turn++) {
    const stream = client.messages.stream({
      model,
      max_tokens: maxTokens,
      system: EDITOR_SYSTEM,
      tools: editorTools,
      messages,
    });

    let text = "";
    stream.on("text", (t) => {
      process.stdout.write(t);
      text += t;
    });

    const response = await stream.finalMessage();
    if (text) {
      process.stdout.write("\n");
      lastText = text;
    }

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
        return {
          ...(await executeTool(
            block.name,
            block.input as Record<string, unknown>,
          )),
          tool_use_id: block.id,
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
