import type Anthropic from "@anthropic-ai/sdk";
import { runEnableTools } from "../tool-groups.js";
import { registration as agentStatus } from "./agent-status.js";
import { registration as askUser } from "./ask-user.js";
import { registration as batch } from "./batch.js";
import { registration as checkpoint } from "./checkpoint.js";
import { registration as clipboard } from "./clipboard.js";
import { registration as codeExec } from "./code-exec.js";
import { registration as computerUse } from "./computer-use.js";
import { registration as customTool, initCustomToolRegistry } from "./custom-tool.js";
import { registration as delegate } from "./delegate.js";
import { registration as fileEdit } from "./file-edit.js";
import { registration as fileRead } from "./file-read.js";
import { registration as fileWrite } from "./file-write.js";
import { registration as filesOverview } from "./files-overview.js";
import { registration as findReplace } from "./find-replace.js";
import { registration as glob } from "./glob.js";
import { registration as grep } from "./grep.js";
import { registration as httpRequest } from "./http-request.js";
import { registration as map } from "./map.js";
import { registration as moduleFactory } from "./module-factory/index.js";
import { registration as multiEdit } from "./multi-edit.js";
import { registration as notebook } from "./notebook.js";
import { registration as notify } from "./notify.js";
import { registration as pipe } from "./pipe.js";
import { registration as process_ } from "./process.js";
import { registration as readDocument } from "./read-document.js";
import { registration as repoMap } from "./repo-map.js";
import { registration as screenshot } from "./screenshot.js";
import { registration as shell } from "./shell.js";
import { registration as sqlite } from "./sqlite.js";
import { getTodoState, registration as todo } from "./todo.js";
import { registration as viewImage } from "./view-image.js";
import { registration as webFetch } from "./web-fetch.js";
import { registration as webSearch } from "./web-search.js";
import { registration as workspace } from "./workspace.js";

export type ToolResultBlock =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } };

export type ToolResult = {
  content: string;
  blocks?: ToolResultBlock[];
  is_error?: boolean;
};

type ToolRunner = (input: Record<string, unknown>) => Promise<ToolResult>;

/** Co-located tool metadata. Each tool file exports one of these. */
export type ToolRegistration = {
  tool: Anthropic.Tool;
  runner: ToolRunner;
  /** Risk classification for guardrails. */
  risk: "safe" | "moderate" | "dangerous";
  /** Tool group for progressive disclosure. Undefined = core (always available). */
  group?: string;
};

// ─── Core tool registrations ──────────────────────────────────────────
// Adding a new tool? Export a `registration` from the tool file and add it here.
// Risk and group metadata live in the tool file — no need to edit guardrails or module-factory.
//
// Lazy initialization: some tool files have circular import chains through
// this module (e.g., delegate.ts → context.ts → tools/index.ts → delegate.ts).
// Building the registry at module level would access uninitialized ESM bindings.
// Instead, we build on first access when all modules have finished loading.

const registrationImports = [
  () => agentStatus,
  () => shell,
  () => fileRead,
  () => fileWrite,
  () => fileEdit,
  () => multiEdit,
  () => grep,
  () => glob,
  () => todo,
  () => repoMap,
  () => delegate,
  () => webFetch,
  () => webSearch,
  () => askUser,
  () => httpRequest,
  () => process_,
  () => codeExec,
  () => findReplace,
  () => notebook,
  () => filesOverview,
  () => customTool,
  () => checkpoint,
  () => moduleFactory,
  () => notify,
  () => screenshot,
  () => readDocument,
  () => clipboard,
  () => computerUse,
  () => sqlite,
  () => viewImage,
  () => batch,
  () => pipe,
  () => map,
  () => workspace,
];

let _coreRegistrations: ToolRegistration[] | null = null;
let _initialized = false;

/** Returns all core tool registrations with metadata. */
export function getCoreRegistrations(): readonly ToolRegistration[] {
  if (!_coreRegistrations) {
    _coreRegistrations = registrationImports.map((fn) => fn());
  }
  return _coreRegistrations;
}

// ─── Build runners and tools from registrations (lazy) ───────────────

const runners: Record<string, ToolRunner> = {};
const tools: Anthropic.Tool[] = [];

function ensureInit(): void {
  if (_initialized) return;
  _initialized = true;
  runners.enable_tools = runEnableTools;
  for (const reg of getCoreRegistrations()) {
    runners[reg.tool.name] = reg.runner;
    tools.push(reg.tool);
  }
}

/** Returns the full tool list (core + module-registered). Read-only. */
export function getAllTools(): readonly Anthropic.Tool[] {
  ensureInit();
  return tools;
}

export async function executeTool(
  name: string,
  input: Record<string, unknown>,
): Promise<ToolResult> {
  ensureInit();
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
  ensureInit();
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
  ensureInit();
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
  ensureInit();
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
  ensureInit();
  return tools.filter((t) => customToolNames.has(t.name));
}

export function clearCustomTools(): void {
  ensureInit();
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
