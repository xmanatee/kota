import type Anthropic from "@anthropic-ai/sdk";
import { runEnableTools } from "../tool-groups.js";
import { askUserTool, runAskUser } from "./ask-user.js";
import { codeExecTool, runCodeExec } from "./code-exec.js";
import { delegateTool, runDelegate } from "./delegate.js";
import { fileEditTool, runFileEdit } from "./file-edit.js";
import { fileReadTool, runFileRead } from "./file-read.js";
import { fileWriteTool, runFileWrite } from "./file-write.js";
import { filesOverviewTool, runFilesOverview } from "./files-overview.js";
import { findReplaceTool, runFindReplace } from "./find-replace.js";
import { globTool, runGlob } from "./glob.js";
import { grepTool, runGrep } from "./grep.js";
import { httpRequestTool, runHttpRequest } from "./http-request.js";
import { multiEditTool, runMultiEdit } from "./multi-edit.js";
import { notebookTool, runNotebook } from "./notebook.js";
import { processTool, runProcess } from "./process.js";
import { repoMapTool, runRepoMap } from "./repo-map.js";
import { runSchedule, scheduleTool } from "./schedule.js";
import { runShell, shellTool } from "./shell.js";
import { getTodoState, runTodo, todoTool } from "./todo.js";
import { runWebFetch, webFetchTool } from "./web-fetch.js";
import { runWebSearch, webSearchTool } from "./web-search.js";

export type ToolResultBlock =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } };

export type ToolResult = {
  content: string;
  blocks?: ToolResultBlock[];
  is_error?: boolean;
};

type ToolRunner = (input: Record<string, unknown>) => Promise<ToolResult>;

const runners: Record<string, ToolRunner> = {
  shell: runShell,
  file_read: runFileRead,
  file_write: runFileWrite,
  file_edit: runFileEdit,
  multi_edit: runMultiEdit,
  grep: runGrep,
  glob: runGlob,
  todo: runTodo,
  repo_map: runRepoMap,
  delegate: runDelegate,
  web_fetch: runWebFetch,
  web_search: runWebSearch,
  ask_user: runAskUser,
  http_request: runHttpRequest,
  process: runProcess,
  code_exec: runCodeExec,
  find_replace: runFindReplace,
  notebook: runNotebook,
  files_overview: runFilesOverview,
  schedule: runSchedule,
  enable_tools: runEnableTools,
};

export const allTools: Anthropic.Tool[] = [
  shellTool,
  fileReadTool,
  fileWriteTool,
  fileEditTool,
  multiEditTool,
  grepTool,
  globTool,
  todoTool,
  repoMapTool,
  delegateTool,
  webFetchTool,
  webSearchTool,
  askUserTool,
  httpRequestTool,
  processTool,
  codeExecTool,
  findReplaceTool,
  notebookTool,
  filesOverviewTool,
  scheduleTool,
];

export async function executeTool(
  name: string,
  input: Record<string, unknown>,
): Promise<ToolResult> {
  const runner = runners[name];
  if (!runner) {
    return { content: `Unknown tool: ${name}`, is_error: true };
  }
  try {
    return await runner(input);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { content: `Tool error: ${msg}`, is_error: true };
  }
}

// --- Custom tool registry for extensibility ---

const customToolNames = new Set<string>();

export function registerTool(
  tool: Anthropic.Tool,
  runner: ToolRunner,
): void {
  if (runners[tool.name]) {
    throw new Error(`Tool already registered: ${tool.name}`);
  }
  allTools.push(tool);
  runners[tool.name] = runner;
  customToolNames.add(tool.name);
}

export function getRegisteredTools(): Anthropic.Tool[] {
  return allTools.filter((t) => customToolNames.has(t.name));
}

export function clearCustomTools(): void {
  for (const name of customToolNames) {
    const idx = allTools.findIndex((t) => t.name === name);
    if (idx >= 0) allTools.splice(idx, 1);
    delete runners[name];
  }
  customToolNames.clear();
}

export { getTodoState };
