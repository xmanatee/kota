/**
 * Custom Tool Builder — lets the agent create new tools at runtime from Python/Node.js code.
 *
 * Tools are registered in the current session and optionally persisted to `.kota/tools/`
 * for use in future sessions. Custom tools execute in the same REPL sessions as code_exec,
 * so they share state, installed packages, and environment.
 */

import { existsSync, readdirSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { DEFAULT_TIMEOUT, MAX_OUTPUT } from "../data/code-wrappers.js";
import { sessions } from "../repl-session.js";
import {
  type CustomToolDef,
  getToolPath,
  getToolsDir,
  MAX_CUSTOM_TOOLS,
  normalizeSchema,
  saveToDisk,
  validateName,
} from "./custom-tool-persistence.js";

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

export type { CustomToolDef } from "./custom-tool-persistence.js";

// ─── Internal state ───────────────────────────────────────────────────

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
  const language = (input.language as CustomToolDef["language"]) || "python";
  const persist = (input.persist as boolean) || false;
  const rawParams = input.parameters as Record<string, unknown> | undefined;

  const nameErr = validateName(name);
  if (nameErr) return { content: nameErr, is_error: true };

  if (!description) return { content: "Error: description is required", is_error: true };
  if (!code) return { content: "Error: code is required", is_error: true };
  if (language !== "python" && language !== "node") {
    return { content: `Error: language must be "python" or "node"`, is_error: true };
  }

  const parameters = normalizeSchema(rawParams);
  if (typeof parameters === "string") return { content: parameters, is_error: true };

  if (customDefs.size >= MAX_CUSTOM_TOOLS && !customDefs.has(name)) {
    return { content: `Error: maximum ${MAX_CUSTOM_TOOLS} custom tools reached. Remove one first.`, is_error: true };
  }

  if (customDefs.has(name)) {
    _deregister(name);
    customDefs.delete(name);
  }

  const def: CustomToolDef = { name, description, parameters, code, language, timeoutMs: DEFAULT_TIMEOUT };

  const toolDef: Anthropic.Tool = {
    name,
    description,
    input_schema: parameters as Anthropic.Tool.InputSchema,
  };

  _register(toolDef, buildRunner(def));
  customDefs.set(name, def);

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

      if (customDefs.has(raw.name)) continue;

      const def: CustomToolDef = {
        name: raw.name,
        description: raw.description,
        parameters: normalizeSchema(raw.parameters) as Record<string, unknown>,
        code: raw.code,
        language: raw.language === "node" ? "node" : "python",
        timeoutMs: DEFAULT_TIMEOUT,
      };

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

export const registration = {
  tool: customToolTool,
  runner: runCustomTool,
  risk: "moderate" as const,
  kind: "action" as const,
};
