/**
 * Custom tool action handlers and execution builder.
 * Extracted from custom-tool.ts to keep that file focused on schema, registry, and persistence.
 */

import { existsSync, unlinkSync } from "node:fs";
import type Anthropic from "@anthropic-ai/sdk";
import { DEFAULT_TIMEOUT, MAX_OUTPUT } from "#core/data/code-wrappers.js";
import {
  type CustomToolDef,
  getToolPath,
  MAX_CUSTOM_TOOLS,
  normalizeSchema,
  saveToDisk,
  validateName,
} from "./custom-tool-persistence.js";
import { sessions } from "./repl-session.js";

export type ToolResult = { content: string; is_error?: boolean };

type RegisterFn = (tool: Anthropic.Tool, runner: (input: Record<string, unknown>) => Promise<ToolResult>, moduleName?: string) => void;
type DeregisterFn = (name: string) => boolean;

// ─── Create ───────────────────────────────────────────────────────────

export function handleCreate(
  input: Record<string, unknown>,
  customDefs: Map<string, CustomToolDef>,
  register: RegisterFn,
  deregister: DeregisterFn,
): ToolResult {
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
    deregister(name);
    customDefs.delete(name);
  }

  const def: CustomToolDef = { name, description, parameters, code, language, timeoutMs: DEFAULT_TIMEOUT };

  const toolDef: Anthropic.Tool = {
    name,
    description,
    input_schema: parameters as Anthropic.Tool.InputSchema,
  };

  register(toolDef, buildRunner(def));
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

export function handleList(customDefs: Map<string, CustomToolDef>): ToolResult {
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

export function handleRemove(
  input: Record<string, unknown>,
  customDefs: Map<string, CustomToolDef>,
  deregister: DeregisterFn,
): ToolResult {
  const name = (input.name as string || "").trim();
  if (!name) return { content: "Error: name is required for remove", is_error: true };

  if (!customDefs.has(name)) {
    return { content: `Error: no custom tool named "${name}"`, is_error: true };
  }

  deregister(name);
  customDefs.delete(name);

  const diskPath = getToolPath(name);
  if (existsSync(diskPath)) unlinkSync(diskPath);

  return { content: `Removed custom tool "${name}".` };
}

// ─── Execution builder ────────────────────────────────────────────────

export function buildRunner(def: CustomToolDef): (input: Record<string, unknown>) => Promise<ToolResult> {
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
