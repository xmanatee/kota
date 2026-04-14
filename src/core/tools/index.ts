import type Anthropic from "@anthropic-ai/sdk";
import { registration as agentStatus } from "./agent-status.js";
import { registration as approval } from "./approval.js";
import { registration as askUser } from "./ask-user.js";
import { registration as checkpoint } from "./checkpoint.js";
import { registration as confirm } from "./confirm.js";
import { registration as customTool, initCustomToolRegistry } from "./custom-tool.js";
import { registration as delegate } from "./delegate.js";
import { registration as moduleFactory } from "./module-factory/index.js";
import { getTodoState, registration as todo } from "./todo.js";
import { deregisterToolsFromGroups, registerCustomGroup, runEnableTools } from "./tool-groups.js";
import type { ToolResult, ToolResultBlock } from "./tool-result.js";

export type { ToolResult, ToolResultBlock };

type ToolRunner = (input: Record<string, unknown>) => Promise<ToolResult>;

/** Co-located tool metadata. Each tool file exports one of these. */
export type ToolRegistration = {
  tool: Anthropic.Tool;
  runner: ToolRunner;
  /** Risk classification for guardrails. */
  risk: "safe" | "moderate" | "dangerous";
  /** Tool group for progressive disclosure. Undefined = core (always available). */
  group?: string;
  /**
   * Capability category for phase-level safety checks.
   * - discovery: read-only, no side effects (file reads, search, listing)
   * - action: can modify state (writes, execution, network mutations, orchestration)
   */
  kind: "discovery" | "action";
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
  () => approval,
  () => todo,
  () => delegate,
  () => askUser,
  () => confirm,
  () => customTool,
  () => checkpoint,
  () => moduleFactory,
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

/** Returns the kind of a tool by name, checking core then module-registered tools. */
export function getToolKind(name: string): "discovery" | "action" | undefined {
  return getCoreRegistrations().find((r) => r.tool.name === name)?.kind
    ?? moduleToolMeta.get(name)?.kind;
}

/** Returns the risk level of a module-registered tool by name. */
export function getModuleToolRisk(name: string): "safe" | "moderate" | "dangerous" | undefined {
  return moduleToolMeta.get(name)?.risk;
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
    if (reg.group) registerCustomGroup(reg.group, [reg.tool.name]);
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
/** Risk/kind metadata for module-registered tools. */
const moduleToolMeta = new Map<string, { risk: "safe" | "moderate" | "dangerous"; kind: "discovery" | "action" }>();

export function registerTool(
  tool: Anthropic.Tool,
  runner: ToolRunner,
  moduleName?: string,
  meta?: { risk: "safe" | "moderate" | "dangerous"; kind: "discovery" | "action" },
): void {
  ensureInit();
  if (runners[tool.name]) {
    throw new Error(`Tool already registered: ${tool.name}`);
  }
  tools.push(tool);
  runners[tool.name] = runner;
  customToolNames.add(tool.name);
  if (meta) {
    moduleToolMeta.set(tool.name, { risk: meta.risk, kind: meta.kind });
  }
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
  moduleToolMeta.delete(name);
  // Remove from module ownership tracking
  for (const [owner, owned] of moduleToolOwners) {
    if (owned.delete(name) && owned.size === 0) {
      moduleToolOwners.delete(owner);
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
    moduleToolMeta.delete(name);
  }
  deregisterToolsFromGroups(owned);
  moduleToolOwners.delete(moduleName);
}

export function getRegisteredTools(): Anthropic.Tool[] {
  ensureInit();
  return tools.filter((t) => customToolNames.has(t.name));
}

/** Returns the names of all tools registered by a given module. */
export function getModuleToolNames(moduleName: string): string[] {
  return [...(moduleToolOwners.get(moduleName) ?? [])];
}

/**
 * Resolve a subset of registered tools by name.
 * Returns matching tool definitions and runners; silently skips unknown names.
 * Callers can override individual entries after resolution (e.g. bounded shell).
 */
export function resolveToolSet(names: readonly string[]): { tools: Anthropic.Tool[]; runners: Record<string, ToolRunner> } {
  ensureInit();
  const resolvedTools: Anthropic.Tool[] = [];
  const resolvedRunners: Record<string, ToolRunner> = {};
  for (const name of names) {
    const tool = tools.find((t) => t.name === name);
    const runner = runners[name];
    if (tool && runner) {
      resolvedTools.push(tool);
      resolvedRunners[name] = runner;
    }
  }
  return { tools: resolvedTools, runners: resolvedRunners };
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
  moduleToolMeta.clear();
}

// Inject registry functions into custom-tool module (breaks circular dependency)
initCustomToolRegistry(registerTool, deregisterTool);

export { getTodoState };
