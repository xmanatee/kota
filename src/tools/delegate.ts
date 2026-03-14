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
import { processTool, runProcess } from "./process.js";
import { codeExecTool, runCodeExec } from "./code-exec.js";
import { truncateToolResult } from "../context.js";
import type { CostTracker } from "../cost.js";

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

// --- System prompt builders ---

const EXPLORE_BASE = `You are a research assistant. You can explore codebases and search the web.
Answer the question by reading files, searching code, finding patterns, and looking up documentation online.
Be thorough but concise in your final answer.
You have read-only access — you cannot modify files.`;

const EXECUTE_BASE = `You are a task executor. You can read, search, and modify files, and run shell commands.
Execute the assigned task precisely. Focus on the specific files and changes described.
After making changes, verify they work if possible (e.g. run a relevant test or type check).
Shell commands have a 60-second timeout.
When done, summarize what you changed and why.`;

/** Build a sub-agent system prompt enriched with project context. */
export function buildSubAgentPrompt(base: string, config: DelegateConfig): string {
  const parts = [base];

  if (config.cwd) {
    parts.push(`\nWorking directory: ${config.cwd}`);
  }

  if (config.projectContext) {
    parts.push(`\n${config.projectContext}`);
  }

  return parts.join("\n");
}

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
  ...exploreTools, fileEditTool, fileWriteTool, multiEditTool, subShellTool, processTool, codeExecTool,
];

const executeRunners: Record<string, ToolRunner> = {
  ...exploreRunners,
  file_edit: runFileEdit,
  file_write: runFileWrite,
  multi_edit: runMultiEdit,
  shell: runShellBounded,
  process: runProcess,
  code_exec: runCodeExec,
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
  const basePrompt = isExecute ? EXECUTE_BASE : EXPLORE_BASE;
  const systemPrompt = buildSubAgentPrompt(basePrompt, delegateConfig);
  const modifiedFiles = new Set<string>();

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
    const toolsSummary = toolNames.length > 0 ? ` — ${toolNames.join(", ")}` : "";
    console.error(`[kota] delegate(${mode}) turn ${turn + 1}/${maxTurns}${toolsSummary}`);

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

        if (isExecute && !result.is_error) {
          for (const f of extractModifiedFiles(block.name, toolInput)) {
            modifiedFiles.add(f);
          }
        }

        return {
          tool_use_id: block.id,
          content: truncateToolResult(result.content, SUB_AGENT_RESULT_LIMIT),
          is_error: result.is_error,
        };
      }),
    );

    const validResults = results.filter((r): r is NonNullable<typeof r> => r !== null);

    // Failure tracking: circuit break on repeated identical errors
    const failedResults = validResults.filter((r) => r.is_error);
    if (failedResults.length > 0) {
      const sig = failedResults.map((r) => r.content).join("|");
      if (sig === lastErrorSig) {
        identicalErrorCount++;
        if (identicalErrorCount >= IDENTICAL_FAILURE_LIMIT) {
          console.error(`[kota] delegate(${mode}) circuit break — same error ${IDENTICAL_FAILURE_LIMIT}x`);
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

    messages.push({
      role: "user",
      content: validResults.map((r) => ({
        type: "tool_result" as const,
        tool_use_id: r.tool_use_id,
        content: r.content,
        is_error: r.is_error,
      })),
    });
  }

  console.error(`[kota] delegate(${mode}) done — ${totalTurns} turn(s)`);

  if (!lastText && modifiedFiles.size === 0) {
    return { content: "Sub-agent completed without producing a response." };
  }

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
