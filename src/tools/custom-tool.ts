/**
 * Custom Tool Builder — lets the agent create new tools at runtime from Python/Node.js code.
 *
 * Tools are registered in the current session and optionally persisted to `.kota/tools/`
 * for use in future sessions. Custom tools execute in the same REPL sessions as code_exec,
 * so they share state, installed packages, and environment.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { DEFAULT_TIMEOUT, MAX_OUTPUT } from "../code-wrappers.js";
import { type Language, sessions } from "../repl-session.js";

// Avoid circular dependency: index.ts imports from us, so we accept
// registerTool/deregisterTool via injection instead of importing them.
type RegisterFn = (tool: Anthropic.Tool, runner: (input: Record<string, unknown>) => Promise<ToolResult>, moduleName?: string) => void;
type DeregisterFn = (name: string) => boolean;

let _register: RegisterFn;
let _deregister: DeregisterFn;

/** Inject tool registry functions. Called once from index.ts after definitions. */
export function initCustomToolRegistry(register: RegisterFn, deregister: DeregisterFn): void {
  _register = register;
  _deregister = deregister;
}

export type ToolResult = { content: string; is_error?: boolean };

const MAX_CUSTOM_TOOLS = 20;
const TOOL_NAME_RE = /^[a-z][a-z0-9_]{1,48}[a-z0-9]$/;
const RESERVED_NAMES = new Set([
  "shell", "file_read", "file_write", "file_edit", "multi_edit", "find_replace",
  "grep", "glob", "todo", "repo_map", "delegate", "web_fetch", "web_search",
  "ask_user", "http_request", "process", "code_exec", "notebook", "files_overview",
  "enable_tools", "custom_tool", "module_factory", "memory", "schedule", "get_secret",
]);

// ─── Internal state ───────────────────────────────────────────────────

export type CustomToolDef = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  code: string;
  language: Language;
  timeoutMs: number;
};

const customDefs = new Map<string, CustomToolDef>();

// ─── Tool definition ──────────────────────────────────────────────────

export const customToolTool: Anthropic.Tool = {
  name: "custom_tool",
  description:
    "Create, list, or remove custom tools that run Python or Node.js code. " +
    "Custom tools appear in the tool list and can be called like any built-in tool. " +
    "Use for reusable API wrappers, data processors, validators, or domain-specific utilities.",
  input_schema: {
    type: "object" as const,
    properties: {
      action: {
        type: "string",
        enum: ["create", "list", "remove"],
        description: "Action to perform",
      },
      name: {
        type: "string",
        description: "Tool name (snake_case, 3-50 chars, no conflicts with built-in tools). Required for create/remove.",
      },
      description: {
        type: "string",
        description: "What the tool does. Required for create.",
      },
      parameters: {
        type: "object",
        description: 'JSON Schema for tool input. Must have type:"object" and properties. Omit for no-param tools.',
      },
      code: {
        type: "string",
        description:
          "Python or Node.js code. Receives `params` dict/object with input values. " +
          "Print output to stdout — it becomes the tool result. Required for create.",
      },
      language: {
        type: "string",
        enum: ["python", "node"],
        description: "Language runtime (default: python)",
      },
      persist: {
        type: "boolean",
        description: "Save tool to .kota/tools/ for future sessions (default: false)",
      },
    },
    required: ["action"],
  },
};

// ─── Runner ───────────────────────────────────────────────────────────

export async function runCustomTool(input: Record<string, unknown>): Promise<ToolResult> {
  const action = input.action as string;
  switch (action) {
    case "create":
      return handleCreate(input);
    case "list":
      return handleList();
    case "remove":
      return handleRemove(input);
    default:
      return { content: `Unknown action: "${action}". Use create, list, or remove.`, is_error: true };
  }
}

// ─── Create ───────────────────────────────────────────────────────────

function handleCreate(input: Record<string, unknown>): ToolResult {
  const name = (input.name as string || "").trim();
  const description = (input.description as string || "").trim();
  const code = (input.code as string || "").trim();
  const language = (input.language as Language) || "python";
  const persist = (input.persist as boolean) || false;
  const rawParams = input.parameters as Record<string, unknown> | undefined;

  // Validate name
  const nameErr = validateName(name);
  if (nameErr) return { content: nameErr, is_error: true };

  // Validate required fields
  if (!description) return { content: "Error: description is required", is_error: true };
  if (!code) return { content: "Error: code is required", is_error: true };
  if (language !== "python" && language !== "node") {
    return { content: `Error: language must be "python" or "node"`, is_error: true };
  }

  // Validate/default parameters schema
  const parameters = normalizeSchema(rawParams);
  if (typeof parameters === "string") return { content: parameters, is_error: true };

  // Check limit
  if (customDefs.size >= MAX_CUSTOM_TOOLS && !customDefs.has(name)) {
    return { content: `Error: maximum ${MAX_CUSTOM_TOOLS} custom tools reached. Remove one first.`, is_error: true };
  }

  // If replacing an existing custom tool, deregister the old one first
  if (customDefs.has(name)) {
    _deregister(name);
    customDefs.delete(name);
  }

  const def: CustomToolDef = {
    name,
    description,
    parameters,
    code,
    language,
    timeoutMs: DEFAULT_TIMEOUT,
  };

  // Build the Anthropic tool definition
  const toolDef: Anthropic.Tool = {
    name,
    description,
    input_schema: parameters as Anthropic.Tool.InputSchema,
  };

  // Register in the tool system
  _register(toolDef, buildRunner(def));
  customDefs.set(name, def);

  // Persist if requested
  if (persist) {
    try {
      saveToDisk(def);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: `Tool "${name}" created (session-only). Failed to persist: ${msg}` };
    }
  }

  const persistNote = persist ? " (persisted to .kota/tools/)" : " (session-only)";
  const paramNames = Object.keys((parameters.properties || {}) as Record<string, unknown>);
  const paramsSummary = paramNames.length > 0 ? `Parameters: ${paramNames.join(", ")}` : "No parameters";
  return { content: `Created custom tool "${name}"${persistNote}. ${paramsSummary}. Language: ${language}.` };
}

// ─── List ─────────────────────────────────────────────────────────────

function handleList(): ToolResult {
  if (customDefs.size === 0) {
    return { content: "No custom tools defined. Use action: create to define one." };
  }
  const lines = [...customDefs.values()].map((d) => {
    const params = Object.keys((d.parameters.properties || {}) as Record<string, unknown>);
    const paramStr = params.length > 0 ? `(${params.join(", ")})` : "()";
    return `- ${d.name}${paramStr} [${d.language}]: ${d.description}`;
  });
  return { content: `Custom tools (${customDefs.size}):\n${lines.join("\n")}` };
}

// ─── Remove ───────────────────────────────────────────────────────────

function handleRemove(input: Record<string, unknown>): ToolResult {
  const name = (input.name as string || "").trim();
  if (!name) return { content: "Error: name is required for remove", is_error: true };

  if (!customDefs.has(name)) {
    return { content: `Error: no custom tool named "${name}"`, is_error: true };
  }

  _deregister(name);
  customDefs.delete(name);

  // Also remove from disk if it exists
  const diskPath = getToolPath(name);
  if (existsSync(diskPath)) {
    try {
      unlinkSync(diskPath);
    } catch { /* ignore cleanup errors */ }
  }

  return { content: `Removed custom tool "${name}".` };
}

// ─── Custom tool execution ────────────────────────────────────────────

function buildRunner(def: CustomToolDef): (input: Record<string, unknown>) => Promise<ToolResult> {
  return async (input) => {
    const paramsJson = JSON.stringify(input);
    const b64 = Buffer.from(paramsJson).toString("base64");

    const wrapper = def.language === "python"
      ? `import json as __j, base64 as __b\nparams = __j.loads(__b.b64decode('${b64}').decode())\n${def.code}`
      : `const params = JSON.parse(Buffer.from('${b64}','base64').toString());\n${def.code}`;

    const session = sessions[def.language];
    const { output, isError } = await session.execute(wrapper, def.timeoutMs);

    const truncated = output.length > MAX_OUTPUT
      ? `${output.slice(0, MAX_OUTPUT)}\n[truncated — ${output.length} chars total]`
      : output;

    return { content: truncated, is_error: isError };
  };
}

// ─── Persistence ──────────────────────────────────────────────────────

function getToolsDir(): string {
  return join(process.cwd(), ".kota", "tools");
}

function getToolPath(name: string): string {
  return join(getToolsDir(), `${name}.json`);
}

function saveToDisk(def: CustomToolDef): void {
  const dir = getToolsDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const data = {
    name: def.name,
    description: def.description,
    parameters: def.parameters,
    code: def.code,
    language: def.language,
  };
  writeFileSync(getToolPath(def.name), JSON.stringify(data, null, 2));
}

/** Load saved custom tools from .kota/tools/. Returns count of tools loaded. */
export function loadSavedTools(): number {
  const dir = getToolsDir();
  if (!existsSync(dir)) return 0;

  let loaded = 0;
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    try {
      const raw = JSON.parse(readFileSync(join(dir, file), "utf-8"));
      if (!raw.name || !raw.code || !raw.description) continue;

      // Skip if already registered (e.g., daemon mode reuse)
      if (customDefs.has(raw.name)) continue;

      const def: CustomToolDef = {
        name: raw.name,
        description: raw.description,
        parameters: normalizeSchema(raw.parameters) as Record<string, unknown>,
        code: raw.code,
        language: raw.language === "node" ? "node" : "python",
        timeoutMs: DEFAULT_TIMEOUT,
      };

      // Skip if normalizeSchema returned an error string
      if (typeof def.parameters === "string") continue;

      const toolDef: Anthropic.Tool = {
        name: def.name,
        description: def.description,
        input_schema: def.parameters as Anthropic.Tool.InputSchema,
      };

      _register(toolDef, buildRunner(def));
      customDefs.set(def.name, def);
      loaded++;
    } catch { /* skip invalid tool files */ }
  }
  return loaded;
}

/** Get count of active custom tools. */
export function getCustomToolCount(): number {
  return customDefs.size;
}

/** Clear all custom tool definitions (for testing). */
export function resetCustomTools(): void {
  for (const name of customDefs.keys()) {
    try { _deregister(name); } catch { /* ignore */ }
  }
  customDefs.clear();
}

// ─── Validation helpers ───────────────────────────────────────────────

function validateName(name: string): string | null {
  if (!name) return "Error: name is required";
  if (!TOOL_NAME_RE.test(name)) {
    return `Error: name must be snake_case, 3-50 chars (lowercase letters, digits, underscores). Got: "${name}"`;
  }
  if (RESERVED_NAMES.has(name)) {
    return `Error: "${name}" conflicts with a built-in tool name`;
  }
  return null;
}

function normalizeSchema(raw: Record<string, unknown> | undefined): Record<string, unknown> | string {
  if (!raw) {
    return { type: "object", properties: {} };
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return "Error: parameters must be a JSON Schema object";
  }
  if (raw.type !== "object") {
    return 'Error: parameters.type must be "object"';
  }
  if (typeof raw.properties !== "object" || raw.properties === null) {
    return "Error: parameters must have a properties field";
  }
  return raw;
}
export const registration = {
	tool: customToolTool,
	runner: runCustomTool,
	risk: "moderate" as const,
};
