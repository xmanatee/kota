import type Anthropic from "@anthropic-ai/sdk";
import type { ToolResult } from "./tools/index.js";
import { fileReadTool, runFileRead } from "./tools/file-read.js";
import { fileEditTool, runFileEdit } from "./tools/file-edit.js";
import { fileWriteTool, runFileWrite } from "./tools/file-write.js";
import { multiEditTool, runMultiEdit } from "./tools/multi-edit.js";
import { grepTool, runGrep } from "./tools/grep.js";
import { globTool, runGlob } from "./tools/glob.js";
import { repoMapTool, runRepoMap } from "./tools/repo-map.js";
import { webFetchTool, runWebFetch } from "./tools/web-fetch.js";
import { webSearchTool, runWebSearch } from "./tools/web-search.js";
import { httpRequestTool, runHttpRequest } from "./tools/http-request.js";
import { runShell } from "./tools/shell.js";
import { processTool, runProcess } from "./tools/process.js";
import { codeExecTool, runCodeExec } from "./tools/code-exec.js";
import { findReplaceTool, runFindReplace } from "./tools/find-replace.js";

// --- Sub-agent system prompts ---

export const EXPLORE_PROMPT = `You are a research sub-agent. Gather information and return a clear, structured answer.

## Strategy
- For codebases: repo_map first for structure, then targeted file_read + grep.
- For web research: web_search with 2-3 diverse queries, then web_fetch top sources.
  - Prefer official sources (docs, vendor pages) over secondary summaries.
  - Note publication dates — flag findings older than 1 year as potentially stale.
  - If a source is inaccessible (paywall, 403, timeout), note it and move on.
- For data analysis: use code_exec (Python/Node.js REPL) to process numbers, compute statistics, or create matplotlib charts. Charts are auto-captured as images.
- For system info: use shell (60s timeout) for git commands, version checks, dependency listings, and process info.
- For API exploration: use http_request for direct API calls; web_fetch for documentation pages.
- Batch independent tool calls in one turn (e.g., grep + glob together, multiple web_fetch calls).
- Cross-reference findings across multiple sources. Note disagreements.
- You have read-only access — do not modify project files. Use shell for information gathering only.

## Response Format
- Lead with the answer, not the process you followed.
- Use tables for comparisons. Cite URLs for web findings.
- Include charts/visualizations when data supports it.
- Distinguish confirmed facts from inferences. Flag outdated information.`;

export const EXECUTE_PROMPT = `You are a task execution sub-agent. Complete the assigned task precisely.

## Approach
- Read files before editing. Understand existing code and patterns first.
- Use file_edit for targeted changes, multi_edit for batch changes, file_write for new files.
- For computation or prototyping: code_exec (persistent Python/Node.js REPL). Charts are auto-captured.
- For looking up docs or APIs during implementation: web_search / web_fetch / http_request.
- After changes, verify: run relevant tests or type checks via shell (60s timeout).
- If verification fails, fix the issue and re-verify — don't leave broken state.

## Error Recovery
- file_edit fails (string not found): re-read the file with file_read, then retry with exact content.
- Shell command fails: read the error output, adjust approach, retry differently.
- Import errors in code_exec: install the package via shell first.

## Response Format
- Summarize: what changed, which files, why.
- Report verification results (test/typecheck pass or fail).
- If blocked, explain what's preventing completion.`;

// --- Tool sets ---

type ToolRunner = (input: Record<string, unknown>) => Promise<ToolResult>;

/** Shell runner with a 60s max timeout for sub-agents. */
export async function runShellBounded(
  input: Record<string, unknown>,
): Promise<ToolResult> {
  const MAX_SUB_TIMEOUT = 60_000;
  return runShell({
    ...input,
    timeout_ms: Math.min(
      (input.timeout_ms as number) || MAX_SUB_TIMEOUT,
      MAX_SUB_TIMEOUT,
    ),
  });
}

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

export const exploreTools: Anthropic.Tool[] = [
  fileReadTool,
  grepTool,
  globTool,
  repoMapTool,
  webFetchTool,
  webSearchTool,
  httpRequestTool,
  codeExecTool,
  subShellTool,
];

export const exploreRunners: Record<string, ToolRunner> = {
  file_read: runFileRead,
  grep: runGrep,
  glob: runGlob,
  repo_map: runRepoMap,
  web_fetch: runWebFetch,
  web_search: runWebSearch,
  http_request: runHttpRequest,
  code_exec: runCodeExec,
  shell: runShellBounded,
};

export const executeTools: Anthropic.Tool[] = [
  ...exploreTools,
  fileEditTool,
  fileWriteTool,
  multiEditTool,
  processTool,
  findReplaceTool,
];

export const executeRunners: Record<string, ToolRunner> = {
  ...exploreRunners,
  file_edit: runFileEdit,
  file_write: runFileWrite,
  multi_edit: runMultiEdit,
  process: runProcess,
  find_replace: runFindReplace,
};

// --- Prompt builder ---

export type PromptConfig = {
  cwd?: string;
  projectContext?: string;
};

/** Build a sub-agent system prompt enriched with project context. */
export function buildSubAgentPrompt(
  base: string,
  config: PromptConfig,
): string {
  const parts = [base];
  if (config.cwd) {
    parts.push(`\nWorking directory: ${config.cwd}`);
  }
  if (config.projectContext) {
    parts.push(`\n${config.projectContext}`);
  }
  return parts.join("\n");
}
