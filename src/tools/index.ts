import type Anthropic from "@anthropic-ai/sdk";
import { runEnableTools } from "../tool-groups.js";
import { askUserTool, runAskUser } from "./ask-user.js";
import { checkpointTool, runCheckpoint } from "./checkpoint.js";
import { clipboardTool, runClipboard } from "./clipboard.js";
import { codeExecTool, runCodeExec } from "./code-exec.js";
import { customToolTool, initCustomToolRegistry, runCustomTool } from "./custom-tool.js";
import { delegateTool, runDelegate } from "./delegate.js";
import { fileEditTool, runFileEdit } from "./file-edit.js";
import { fileReadTool, runFileRead } from "./file-read.js";
import { fileWriteTool, runFileWrite } from "./file-write.js";
import { filesOverviewTool, runFilesOverview } from "./files-overview.js";
import { findReplaceTool, runFindReplace } from "./find-replace.js";
import { globTool, runGlob } from "./glob.js";
import { grepTool, runGrep } from "./grep.js";
import { httpRequestTool, runHttpRequest } from "./http-request.js";
import { moduleFactoryTool, runModuleFactory } from "./module-factory.js";
import { multiEditTool, runMultiEdit } from "./multi-edit.js";
import { notebookTool, runNotebook } from "./notebook.js";
import { notifyTool, runNotify } from "./notify.js";
import { processTool, runProcess } from "./process.js";
import { readDocumentTool, runReadDocument } from "./read-document.js";
import { repoMapTool, runRepoMap } from "./repo-map.js";
import { runScreenshot, screenshotTool } from "./screenshot.js";
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
  custom_tool: runCustomTool,
  checkpoint: runCheckpoint,
  module_factory: runModuleFactory,
  notify: runNotify,
  screenshot: runScreenshot,
  read_document: runReadDocument,
  clipboard: runClipboard,

  enable_tools: runEnableTools,
};

/** Internal mutable tool list — use getAllTools() externally. */
const tools: Anthropic.Tool[] = [
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
  customToolTool,
  checkpointTool,
  moduleFactoryTool,
  notifyTool,
  screenshotTool,
  readDocumentTool,
  clipboardTool,
];

/** Returns the full tool list (core + module-registered). Read-only. */
export function getAllTools(): readonly Anthropic.Tool[] {
  return tools;
}

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
/** Maps module name → set of tool names it registered. */
const moduleToolOwners = new Map<string, Set<string>>();

export function registerTool(
  tool: Anthropic.Tool,
  runner: ToolRunner,
  moduleName?: string,
): void {
  if (runners[tool.name]) {
    throw new Error(`Tool already registered: ${tool.name}`);
  }
  tools.push(tool);
  runners[tool.name] = runner;
  customToolNames.add(tool.name);
  if (moduleName) {
    let owned = moduleToolOwners.get(moduleName);
    if (!owned) {
      owned = new Set();
      moduleToolOwners.set(moduleName, owned);
    }
    owned.add(tool.name);
  }
}

/** Remove a single tool by name. Returns true if found and removed. */
export function deregisterTool(name: string): boolean {
  const idx = tools.findIndex((t) => t.name === name);
  if (idx < 0) return false;
  tools.splice(idx, 1);
  delete runners[name];
  customToolNames.delete(name);
  // Remove from module ownership tracking
  for (const [mod, owned] of moduleToolOwners) {
    if (owned.delete(name) && owned.size === 0) {
      moduleToolOwners.delete(mod);
    }
  }
  return true;
}

/** Remove all tools registered by a specific module. */
export function deregisterModuleTools(moduleName: string): void {
  const owned = moduleToolOwners.get(moduleName);
  if (!owned) return;
  for (const name of owned) {
    const idx = tools.findIndex((t) => t.name === name);
    if (idx >= 0) tools.splice(idx, 1);
    delete runners[name];
    customToolNames.delete(name);
  }
  moduleToolOwners.delete(moduleName);
}

export function getRegisteredTools(): Anthropic.Tool[] {
  return tools.filter((t) => customToolNames.has(t.name));
}

export function clearCustomTools(): void {
  for (const name of customToolNames) {
    const idx = tools.findIndex((t) => t.name === name);
    if (idx >= 0) tools.splice(idx, 1);
    delete runners[name];
  }
  customToolNames.clear();
  moduleToolOwners.clear();
}

// Inject registry functions into custom-tool module (breaks circular dependency)
initCustomToolRegistry(registerTool, deregisterTool);

export { getTodoState };
