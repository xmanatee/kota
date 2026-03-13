import Anthropic from "@anthropic-ai/sdk";
import type { ToolResult } from "./index.js";
import { fileReadTool, runFileRead } from "./file-read.js";
import { grepTool, runGrep } from "./grep.js";
import { globTool, runGlob } from "./glob.js";
import { repoMapTool, runRepoMap } from "./repo-map.js";

export const delegateTool: Anthropic.Tool = {
  name: "delegate",
  description:
    "Delegate a research/exploration task to a sub-agent. The sub-agent gets " +
    "read-only tools (file_read, grep, glob, repo_map) and returns a summary. " +
    "Use this to explore unfamiliar parts of the codebase without cluttering " +
    "your main context with intermediate tool calls.",
  input_schema: {
    type: "object" as const,
    properties: {
      task: {
        type: "string",
        description:
          "What to research or explore (e.g. 'find all API endpoints and list their HTTP methods')",
      },
    },
    required: ["task"],
  },
};

const MAX_TURNS = 10;

const SUB_SYSTEM = `You are a research assistant exploring a codebase.
Answer the question by reading files, searching code, and finding patterns.
Be thorough but concise in your final answer.
You have read-only access — you cannot modify files.`;

const subTools: Anthropic.Tool[] = [fileReadTool, grepTool, globTool, repoMapTool];

const subRunners: Record<string, (input: Record<string, unknown>) => Promise<ToolResult>> = {
  file_read: runFileRead,
  grep: runGrep,
  glob: runGlob,
  repo_map: runRepoMap,
};

export async function runDelegate(
  input: Record<string, unknown>,
): Promise<ToolResult> {
  const task = input.task as string;
  if (!task) {
    return { content: "Error: task is required", is_error: true };
  }

  const client = new Anthropic();
  const model = "claude-sonnet-4-20250514";
  const messages: Anthropic.Messages.MessageParam[] = [
    { role: "user", content: task },
  ];
  let lastText = "";

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await client.messages.create({
      model,
      max_tokens: 4096,
      system: SUB_SYSTEM,
      tools: subTools,
      messages,
    });

    // Collect text from response
    for (const block of response.content) {
      if (block.type === "text") {
        lastText = block.text;
      }
    }

    messages.push({ role: "assistant", content: response.content });

    const toolBlocks = response.content.filter((b) => b.type === "tool_use");
    if (toolBlocks.length === 0) break;

    // Execute read-only tools in parallel
    const results = await Promise.all(
      toolBlocks.map(async (block) => {
        if (block.type !== "tool_use") return null;
        const runner = subRunners[block.name];
        if (!runner) {
          return {
            tool_use_id: block.id,
            content: `Unknown tool: ${block.name}`,
            is_error: true as const,
          };
        }
        const result = await runner(block.input as Record<string, unknown>);
        return {
          tool_use_id: block.id,
          content: result.content,
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

  if (!lastText) {
    return { content: "Sub-agent completed without producing a response." };
  }
  return { content: lastText };
}
