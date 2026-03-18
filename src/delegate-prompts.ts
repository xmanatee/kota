import type Anthropic from "@anthropic-ai/sdk";
import { detectProject, getDirectoryOverview } from "./init.js";
import { codeExecTool, runCodeExec } from "./tools/code-exec.js";
import { fileEditTool, runFileEdit } from "./tools/file-edit.js";
import { fileReadTool, runFileRead } from "./tools/file-read.js";
import { fileWriteTool, runFileWrite } from "./tools/file-write.js";
import { filesOverviewTool, runFilesOverview } from "./tools/files-overview.js";
import { findReplaceTool, runFindReplace } from "./tools/find-replace.js";
import { gitTool, runGit } from "./tools/git.js";
import { globTool, runGlob } from "./tools/glob.js";
import { grepTool, runGrep } from "./tools/grep.js";
import { httpRequestTool, runHttpRequest } from "./tools/http-request.js";
import type { ToolResult } from "./tools/index.js";
import { multiEditTool, runMultiEdit } from "./tools/multi-edit.js";
import { processTool, runProcess } from "./tools/process.js";
import { repoMapTool, runRepoMap } from "./tools/repo-map.js";
import { runShell } from "./tools/shell.js";
import { runWebFetch, webFetchTool } from "./tools/web-fetch.js";
import { runWebSearch, webSearchTool } from "./tools/web-search.js";
import { runWorkspace, workspaceTool } from "./tools/workspace.js";

// --- Sub-agent system prompts ---

export const EXPLORE_PROMPT = `You are a research sub-agent. Gather information and return a clear, structured answer.

## Strategy
- For directory orientation: files_overview for categorized listing with previews, then targeted file_read.
- For codebases: repo_map first for structure, then targeted file_read + grep.
- For web research: web_search with 2-3 diverse queries, then web_fetch top sources.
  - Prefer primary sources (official docs, papers, vendor pages) over secondary summaries.
  - Note publication dates — flag findings older than 1 year as potentially stale.
  - When sources conflict, present both with dates and let the caller decide.
  - If a source is inaccessible (paywall, 403, timeout), note it and move on.
- For structured web data: use http_request(save_to) or web_fetch(save_to) to capture tabular/numeric data, then code_exec to parse and analyze — don't manually extract numbers from HTML.
- For data analysis: use code_exec (Python/Node.js REPL) to process numbers, compute statistics, or create matplotlib charts. Charts are auto-captured as images.
- For system info: use shell (60s timeout) for git commands, version checks, dependency listings, and process info.
- For API exploration: use http_request for direct API calls; web_fetch for documentation pages.
- Batch independent tool calls in one turn (e.g., grep + glob together, multiple web_fetch calls).
- Cross-reference findings across multiple sources. Note disagreements with dates so recency is clear.
- You have read-only access — do not modify project files. Use shell for information gathering only.

## Response Format
- Lead with the answer, not the process you followed.
- Structure: executive summary → key findings (table with source dates) → detailed analysis → sources with URLs.
- Use tables for comparisons. Include source dates in table rows.
- Include charts/visualizations when data supports it.
- Distinguish confirmed facts from inferences. Flag outdated information.`;

export const RESEARCH_PROMPT = `You are a deep research sub-agent. Conduct multi-step research to produce a thorough, well-sourced answer.

## Workflow
1. **Decompose**: Break the question into 2-5 independent sub-questions. State them explicitly before searching.
2. **Search broadly**: For each sub-question, run 2-3 diverse web_search queries (different keywords, angles). Batch independent searches in one turn.
3. **Read deeply**: web_fetch the most promising sources. Prefer primary sources (official docs, papers, vendor pages) over secondary summaries.
4. **Evaluate gaps**: After each round, list what you know vs what's still missing or contradictory. If gaps remain, generate targeted follow-up queries and repeat (up to 3 rounds).
5. **Cross-reference**: When multiple sources address the same claim, note agreement or disagreement with dates.
6. **Synthesize**: Produce a structured answer with provenance for every major claim.

## Tool Strategy
- web_search: 2-3 queries per sub-question, vary keywords and phrasing.
- web_fetch: Read full pages for top results. Use save_to for data-heavy pages, then code_exec to parse.
- http_request: Direct API calls for live data (status endpoints, version checks).
- code_exec: Compute statistics, parse structured data, create charts. Don't manually extract numbers from HTML.
- grep/file_read/repo_map: For codebase research, use these to ground findings in actual code.
- Batch independent tool calls in one turn (e.g., multiple web_search, multiple web_fetch).

## Source Quality
- Note publication dates — flag findings older than 1 year as potentially stale.
- Prefer sources with specific data, benchmarks, or code over opinion pieces.
- If a source is inaccessible (paywall, 403, timeout), note it and try alternatives.
- Track which query found which source for provenance.

## Response Format
- **Executive summary**: 2-3 sentence answer to the original question.
- **Key findings**: Table with columns: Finding | Source | Date | Confidence (high/medium/low).
- **Detailed analysis**: Organized by sub-question. Each claim cites its source.
- **Contradictions & gaps**: What sources disagree on, what couldn't be verified.
- **Sources**: Numbered list with URLs, titles, and dates accessed.`;

export const EXECUTE_PROMPT = `You are a task execution sub-agent. Complete the assigned task precisely.

## Approach
- Read files before editing. Understand existing code and patterns first.
- Use file_edit for targeted changes, multi_edit for batch changes, file_write for new files.
- For computation or prototyping: code_exec (persistent Python/Node.js REPL). Charts are auto-captured.
- For looking up docs or APIs during implementation: web_search / web_fetch / http_request.
- After changes, verify: run relevant tests or type checks via shell (60s timeout).
- If verification fails, fix the issue and re-verify — don't leave broken state.
- For writing/planning tasks: outline → draft → save with file_write. Use web_search to ground claims. Revise the output before returning.

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
  gitTool,
  grepTool,
  globTool,
  repoMapTool,
  filesOverviewTool,
  webFetchTool,
  webSearchTool,
  httpRequestTool,
  codeExecTool,
  subShellTool,
  workspaceTool,
];

export const exploreRunners: Record<string, ToolRunner> = {
  file_read: runFileRead,
  git: runGit,
  grep: runGrep,
  glob: runGlob,
  repo_map: runRepoMap,
  files_overview: runFilesOverview,
  web_fetch: runWebFetch,
  web_search: runWebSearch,
  http_request: runHttpRequest,
  code_exec: runCodeExec,
  shell: runShellBounded,
  workspace: runWorkspace,
};

/** Research mode: same tools as explore (read-only) with higher turn budget. */
export const researchTools: Anthropic.Tool[] = exploreTools;
export const researchRunners: Record<string, ToolRunner> = exploreRunners;

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
    const project = detectProject(config.cwd);
    if (project) parts.push(`Project: ${project}`);
    const overview = getDirectoryOverview(config.cwd);
    if (overview) parts.push(`Directory:\n${overview}`);
  }
  if (config.projectContext) {
    parts.push(`\n${config.projectContext}`);
  }
  return parts.join("\n");
}
