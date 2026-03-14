import Anthropic from "@anthropic-ai/sdk";
import type { ToolResult } from "./index.js";
import { fileReadTool, runFileRead } from "./file-read.js";
import { fileEditTool, runFileEdit } from "./file-edit.js";
import { fileWriteTool, runFileWrite } from "./file-write.js";
import { multiEditTool, runMultiEdit } from "./multi-edit.js";
import { grepTool, runGrep } from "./grep.js";
import { globTool, runGlob } from "./glob.js";
import { repoMapTool, runRepoMap } from "./repo-map.js";
import { webFetchTool, runWebFetch } from "./web-fetch.js";
import { webSearchTool, runWebSearch } from "./web-search.js";
import { httpRequestTool, runHttpRequest } from "./http-request.js";
import { runShell } from "./shell.js";

export const delegateTool: Anthropic.Tool = {
  name: "delegate",
  description:
    "Delegate a task to a sub-agent. Two modes:\n" +
    "- explore (default): read-only research — file_read, grep, glob, repo_map, web_search, web_fetch, http_request\n" +
    "- execute: can modify files and run commands — adds file_edit, file_write, multi_edit, shell (60s timeout)\n" +
    "Use explore to research without cluttering context. " +
    "Use execute to dispatch implementation subtasks (e.g. 'fix the lint errors in src/auth.ts').",
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

let delegateModel = "claude-sonnet-4-6";

export function setDelegateModel(model: string): void {
  delegateModel = model;
}

const EXPLORE_SYSTEM = `You are a research assistant. You can explore codebases and search the web.
Answer the question by reading files, searching code, finding patterns, and looking up documentation online.
Be thorough but concise in your final answer.
You have read-only access — you cannot modify files.`;

const EXECUTE_SYSTEM = `You are a task executor. You can read, search, and modify files, and run shell commands.
Execute the assigned task precisely. Focus on the specific files and changes described.
After making changes, verify they work if possible (e.g. run a relevant test or type check).
Shell commands have a 60-second timeout.
When done, summarize what you changed and why.`;

// --- Tool sets ---

type ToolRunner = (input: Record<string, unknown>) => Promise<ToolResult>;

const exploreTools: Anthropic.Tool[] = [
  fileReadTool, grepTool, globTool, repoMapTool, webFetchTool, webSearchTool, httpRequestTool,
];

const exploreRunners: Record<string, ToolRunner> = {
  file_read: runFileRead,
  grep: runGrep,
  glob: runGlob,
  repo_map: runRepoMap,
  web_fetch: runWebFetch,
  web_search: runWebSearch,
  http_request: runHttpRequest,
};

/** Shell runner with a 60s max timeout for sub-agents. */
async function runShellBounded(input: Record<string, unknown>): Promise<ToolResult> {
  const MAX_SUB_TIMEOUT = 60_000;
  return runShell({
    ...input,
    timeout_ms: Math.min((input.timeout_ms as number) || MAX_SUB_TIMEOUT, MAX_SUB_TIMEOUT),
  });
}

/** Minimal shell tool definition for sub-agents (shorter timeout in description). */
const subShellTool: Anthropic.Tool = {
  name: "shell",
  description:
    "Execute a shell command (max 60s timeout). " +
    "Use for builds, tests, git commands. Commands run in the working directory.",
  input_schema: {
    type: "object" as const,
    properties: {
      command: { type: "string", description: "The shell command to execute" },
      timeout_ms: { type: "number", description: "Timeout in ms (max 60000)" },
    },
    required: ["command"],
  },
};

const executeTools: Anthropic.Tool[] = [
  ...exploreTools, fileEditTool, fileWriteTool, multiEditTool, subShellTool,
];

const executeRunners: Record<string, ToolRunner> = {
  ...exploreRunners,
  file_edit: runFileEdit,
  file_write: runFileWrite,
  multi_edit: runMultiEdit,
  shell: runShellBounded,
};

// --- File modification tracking ---

/** Extract modified file paths from tool call inputs. */
export function extractModifiedFiles(
  toolName: string,
  input: Record<string, unknown>,
): string[] {
  if (toolName === "file_edit" || toolName === "file_write") {
    const path = input.path as string;
    return path ? [path] : [];
  }
  if (toolName === "multi_edit") {
    const edits = input.edits as Array<{ path?: string; file_path?: string }> | undefined;
    if (!edits) return [];
    return edits
      .map((e) => e.path || e.file_path || "")
      .filter(Boolean);
  }
  return [];
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
  const systemPrompt = isExecute ? EXECUTE_SYSTEM : EXPLORE_SYSTEM;
  const modifiedFiles = new Set<string>();

  const client = new Anthropic();
  const messages: Anthropic.Messages.MessageParam[] = [
    { role: "user", content: task },
  ];
  let lastText = "";

  for (let turn = 0; turn < maxTurns; turn++) {
    const response = await client.messages.create({
      model: delegateModel,
      max_tokens: 4096,
      system: systemPrompt,
      tools,
      messages,
    });

    for (const block of response.content) {
      if (block.type === "text") {
        lastText = block.text;
      }
    }

    messages.push({ role: "assistant", content: response.content });

    const toolBlocks = response.content.filter((b) => b.type === "tool_use");
    if (toolBlocks.length === 0) break;

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
        const result = await runner(toolInput);

        // Track file modifications in execute mode
        if (isExecute && !result.is_error) {
          for (const f of extractModifiedFiles(block.name, toolInput)) {
            modifiedFiles.add(f);
          }
        }

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

  if (!lastText && modifiedFiles.size === 0) {
    return { content: "Sub-agent completed without producing a response." };
  }

  // Build result with modified files summary for execute mode
  if (isExecute && modifiedFiles.size > 0) {
    const fileList = [...modifiedFiles].map((f) => `  - ${f}`).join("\n");
    return {
      content:
        `${lastText || "(no summary)"}\n\n` +
        `--- Modified files (${modifiedFiles.size}) ---\n${fileList}`,
    };
  }

  return { content: lastText || "(no output)" };
}
