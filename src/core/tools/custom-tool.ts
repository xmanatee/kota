/**
 * Custom Tool Builder — lets the agent create new tools at runtime from Python/Node.js code.
 *
 * Tools are registered in the current session and optionally persisted to `.kota/tools/`
 * for use in future sessions. Custom tools execute in the same REPL sessions as code_exec,
 * so they share state, installed packages, and environment.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import type { KotaToolInputSchema } from "#core/agent-harness/message-protocol.js";
import { DEFAULT_TIMEOUT } from "./code-wrappers.js";
import { buildRunner, handleCreate, handleList, handleRemove, type ToolResult } from "./custom-tool-handlers.js";
import {
  type CustomToolDef,
  getToolsDir,
  normalizeSchema,
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

export type { ToolResult } from "./custom-tool-handlers.js";

export type { CustomToolDef } from "./custom-tool-persistence.js";

// ─── Internal state ───────────────────────────────────────────────────

const customDefs = new Map<string, CustomToolDef>();

// ─── Tool definition ──────────────────────────────────────────────────

export const customToolTool: Anthropic.Tool = {
  name: "custom_tool",
  description:
    "Create, list, or remove custom tools that run Python or Node.js code. " +
    "Custom tools appear in the tool list and can be called like any project tool. " +
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
        description: "Tool name (snake_case, 3-50 chars, no conflicts with project tools). Required for create/remove.",
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
      return handleCreate(input, customDefs, _register, _deregister);
    case "list":
      return handleList(customDefs);
    case "remove":
      return handleRemove(input, customDefs, _deregister);
    default:
      return { content: `Unknown action: "${action}". Use create, list, or remove.`, is_error: true };
  }
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
        input_schema: def.parameters as KotaToolInputSchema,
      };

      _register(toolDef, buildRunner(def));
      customDefs.set(def.name, def);
      loaded++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[kota] Invalid custom tool file "${file}" skipped: ${msg}`);
    }
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
    _deregister(name);
  }
  customDefs.clear();
}

export const registration = {
  tool: customToolTool,
  runner: runCustomTool,
  risk: "moderate" as const,
  kind: "action" as const,
};
