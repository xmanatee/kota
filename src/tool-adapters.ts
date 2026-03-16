/**
 * Tool format adapters — convert common external tool formats
 * into KOTA's internal ToolDefinition/KotaPlugin.
 *
 * Supported formats:
 * - Simple: { name, description, parameters, run }
 * - OpenAI function-calling: { type: "function", function: { name, description, parameters }, run }
 * - Vercel AI SDK: { description, parameters (Zod or JSON Schema), execute }
 * - Array of simple tools
 * - Native KotaPlugin (pass-through)
 */

import type Anthropic from "@anthropic-ai/sdk";
import type { KotaPlugin, ToolDefinition } from "./plugin-types.js";
import type { ToolResult } from "./tools/index.js";

// --- External format types ---

export type SimpleTool = {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
  run: (input: Record<string, unknown>) => unknown | Promise<unknown>;
  group?: string;
};

export type OpenAIFunctionTool = {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
  run: (input: Record<string, unknown>) => unknown | Promise<unknown>;
  group?: string;
};

/** Vercel AI SDK tool() format — uses `execute` and Zod/JSON Schema parameters. */
export type VercelAITool = {
  description?: string;
  parameters: unknown; // Zod schema, AI SDK jsonSchema(), or raw JSON Schema
  execute: (input: Record<string, unknown>) => unknown | Promise<unknown>;
  group?: string;
};

// --- Result normalization ---

/** Convert arbitrary tool return values to KOTA's ToolResult format. */
export function normalizeResult(value: unknown): ToolResult {
  if (value === null || value === undefined) {
    return { content: "" };
  }
  if (typeof value === "string") {
    return { content: value };
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    // Already a ToolResult
    if (typeof obj.content === "string") {
      return value as ToolResult;
    }
    // Object with text property
    if (typeof obj.text === "string") {
      return { content: obj.text };
    }
    // Serialize anything else
    try {
      return { content: JSON.stringify(value, null, 2) };
    } catch {
      return { content: "[object — could not serialize (circular reference or non-serializable)]" };
    }
  }
  // Numbers, booleans, etc.
  return { content: String(value) };
}

// --- Adapters ---

/**
 * Build a valid Anthropic input_schema from external parameters.
 * Anthropic requires type:"object" — external schemas may have wrong type or
 * be missing `properties`. This ensures the result is always valid.
 */
function buildInputSchema(params?: Record<string, unknown>): Anthropic.Tool.InputSchema {
  const base = params ?? {};
  return {
    ...base,
    type: "object" as const,
    properties: (base.properties as Record<string, unknown>) ?? {},
  };
}

/** Convert a simple tool definition to KOTA's ToolDefinition. */
export function fromSimple(def: SimpleTool): ToolDefinition {
  if (!def.name || typeof def.name !== "string") {
    throw new Error("Simple tool must have a non-empty 'name' string");
  }
  if (typeof def.run !== "function") {
    throw new Error(`Simple tool "${def.name}" must have a 'run' function`);
  }

  const tool: Anthropic.Tool = {
    name: def.name,
    description: def.description || "",
    input_schema: buildInputSchema(def.parameters),
  };

  const runner = async (input: Record<string, unknown>): Promise<ToolResult> => {
    const result = await def.run(input);
    return normalizeResult(result);
  };

  return { tool, runner, group: def.group };
}

/** Convert an OpenAI function-calling tool to KOTA's ToolDefinition. */
export function fromOpenAI(def: OpenAIFunctionTool): ToolDefinition {
  const fn = def.function;
  if (!fn?.name || typeof fn.name !== "string") {
    throw new Error("OpenAI tool must have function.name");
  }
  if (typeof def.run !== "function") {
    throw new Error(`OpenAI tool "${fn.name}" must have a 'run' function`);
  }

  const tool: Anthropic.Tool = {
    name: fn.name,
    description: fn.description || "",
    input_schema: buildInputSchema(fn.parameters),
  };

  const runner = async (input: Record<string, unknown>): Promise<ToolResult> => {
    const result = await def.run(input);
    return normalizeResult(result);
  };

  return { tool, runner, group: def.group };
}

// --- Zod → JSON Schema (lightweight, no zod dependency) ---

/**
 * Extract a JSON Schema from various parameter formats:
 * - Vercel AI SDK's jsonSchema() result (has `.jsonSchema` property)
 * - Raw JSON Schema object (has `type: "object"`)
 * - Zod schema (has `._def.typeName`)
 */
export function extractJsonSchema(params: unknown): Record<string, unknown> {
  if (!params || typeof params !== "object") {
    return { type: "object", properties: {} };
  }

  const p = params as Record<string, unknown>;

  // AI SDK's jsonSchema() — has a `jsonSchema` property
  if (p.jsonSchema && typeof p.jsonSchema === "object") {
    return p.jsonSchema as Record<string, unknown>;
  }

  // Already a JSON Schema object — has `type` property
  if (typeof p.type === "string") {
    return p;
  }

  // Zod schema — has `_def` with `typeName`
  const def = p._def as Record<string, unknown> | undefined;
  if (def?.typeName) {
    return zodDefToJsonSchema(p);
  }

  return { type: "object", properties: {} };
}

/** Convert a Zod schema's _def structure to JSON Schema (handles common types). */
export function zodDefToJsonSchema(schema: unknown): Record<string, unknown> {
  if (!schema || typeof schema !== "object") return {};

  const s = schema as Record<string, unknown>;
  const def = s._def as Record<string, unknown> | undefined;
  if (!def?.typeName) return {};

  const typeName = def.typeName as string;
  const desc = s.description as string | undefined;
  const base: Record<string, unknown> = {};
  if (desc) base.description = desc;

  switch (typeName) {
    case "ZodString": return { ...base, type: "string" };
    case "ZodNumber": return { ...base, type: "number" };
    case "ZodBoolean": return { ...base, type: "boolean" };
    case "ZodLiteral": return { ...base, const: def.value };
    case "ZodEnum":
      return { ...base, type: "string", enum: def.values as string[] };
    case "ZodArray": {
      const items = zodDefToJsonSchema(def.type);
      return { ...base, type: "array", items };
    }
    case "ZodOptional":
    case "ZodNullable":
      return zodDefToJsonSchema(def.innerType);
    case "ZodDefault":
      return zodDefToJsonSchema(def.innerType);
    case "ZodObject": {
      const shape = typeof def.shape === "function"
        ? (def.shape as () => Record<string, unknown>)()
        : def.shape;
      const properties: Record<string, unknown> = {};
      const required: string[] = [];
      if (shape && typeof shape === "object") {
        for (const [key, val] of Object.entries(shape as Record<string, unknown>)) {
          properties[key] = zodDefToJsonSchema(val);
          const valDef = (val as Record<string, unknown>)?._def as Record<string, unknown> | undefined;
          if (valDef?.typeName !== "ZodOptional" && valDef?.typeName !== "ZodDefault") {
            required.push(key);
          }
        }
      }
      const result: Record<string, unknown> = { ...base, type: "object", properties };
      if (required.length > 0) result.required = required;
      return result;
    }
    default:
      return base;
  }
}

/** Convert a Vercel AI SDK tool definition to KOTA's ToolDefinition. */
export function fromVercelAI(def: VercelAITool, name: string): ToolDefinition {
  if (typeof def.execute !== "function") {
    throw new Error(`Vercel AI SDK tool "${name}" must have an 'execute' function`);
  }

  const inputSchema = extractJsonSchema(def.parameters);

  const tool: Anthropic.Tool = {
    name,
    description: def.description || "",
    input_schema: buildInputSchema(
      inputSchema.type === "object" ? inputSchema : undefined,
    ),
  };

  const runner = async (input: Record<string, unknown>): Promise<ToolResult> => {
    const result = await def.execute(input);
    return normalizeResult(result);
  };

  return { tool, runner, group: def.group };
}

// --- Format detection ---

function isKotaPlugin(obj: Record<string, unknown>): boolean {
  return typeof obj.name === "string" && (obj.tools === undefined || Array.isArray(obj.tools));
}

function isOpenAIFormat(obj: Record<string, unknown>): boolean {
  return obj.type === "function" && typeof obj.function === "object" && obj.function !== null;
}

function isSimpleFormat(obj: Record<string, unknown>): boolean {
  return typeof obj.name === "string" && typeof obj.run === "function";
}

function isVercelAIFormat(obj: Record<string, unknown>): boolean {
  return typeof obj.execute === "function" && obj.parameters != null && typeof obj.run !== "function";
}

/**
 * Auto-detect the format of a module export and convert to KotaPlugin.
 *
 * Detection order:
 * 1. Native KotaPlugin (has name + tools array) → pass-through
 * 2. OpenAI function-calling (has type:"function" + function object) → adapt
 * 3. Simple tool (has name + run function) → adapt
 * 4. Array of tools (each element is simple or OpenAI) → adapt all
 *
 * Throws if the export doesn't match any recognized format.
 */
export function adaptExport(exported: unknown, fileName: string): KotaPlugin {
  if (!exported || typeof exported !== "object") {
    throw new Error(`${fileName}: export is not an object or array`);
  }

  // Array of tools
  if (Array.isArray(exported)) {
    return adaptArray(exported, fileName);
  }

  const obj = exported as Record<string, unknown>;

  // Native KotaPlugin — has name + optional tools/hooks.
  // A plugin with just a name is valid (might register groups via onLoad, or be a placeholder).
  // We distinguish from simple tools by checking that it does NOT have a 'run' function.
  if (isKotaPlugin(obj) && typeof obj.run !== "function") {
    // If it has tools, check if they're already in ToolDefinition format
    if (Array.isArray(obj.tools) && obj.tools.length > 0) {
      const first = obj.tools[0] as Record<string, unknown>;
      if (first.tool && first.runner) {
        // Already native format
        return exported as KotaPlugin;
      }
      // Tools array but in simple/openai format — adapt each
      const tools = adaptToolArray(obj.tools as Record<string, unknown>[], fileName);
      return {
        name: obj.name as string,
        version: obj.version as string | undefined,
        tools,
        onLoad: obj.onLoad as KotaPlugin["onLoad"],
        onUnload: obj.onUnload as KotaPlugin["onUnload"],
      };
    }
    return exported as KotaPlugin;
  }

  // Single OpenAI format tool
  if (isOpenAIFormat(obj)) {
    const tool = fromOpenAI(obj as unknown as OpenAIFunctionTool);
    const name = pluginNameFromFile(fileName);
    return { name, tools: [tool] };
  }

  // Single simple format tool
  if (isSimpleFormat(obj)) {
    const tool = fromSimple(obj as unknown as SimpleTool);
    const name = (obj.name as string) || pluginNameFromFile(fileName);
    return { name, tools: [tool] };
  }

  // Single Vercel AI SDK tool (has `execute` + `parameters`, no `name`)
  if (isVercelAIFormat(obj)) {
    const name = pluginNameFromFile(fileName);
    const tool = fromVercelAI(obj as unknown as VercelAITool, name);
    return { name, tools: [tool] };
  }

  // Map of Vercel AI SDK tools: { toolName: { execute, parameters }, ... }
  const entries = Object.entries(obj);
  if (entries.length > 0 && entries.every(([, v]) =>
    v && typeof v === "object" && isVercelAIFormat(v as Record<string, unknown>),
  )) {
    const tools = entries.map(([key, val]) =>
      fromVercelAI(val as unknown as VercelAITool, key),
    );
    return { name: pluginNameFromFile(fileName), tools };
  }

  throw new Error(
    `${fileName}: unrecognized export format. Expected KotaPlugin, OpenAI function tool, ` +
      `simple tool { name, description, run }, Vercel AI SDK tool { execute, parameters }, ` +
      `or an array of tools.`,
  );
}

function adaptArray(arr: unknown[], fileName: string): KotaPlugin {
  if (arr.length === 0) {
    throw new Error(`${fileName}: empty tool array`);
  }

  const tools = adaptToolArray(
    arr.map((item) => {
      if (!item || typeof item !== "object") {
        throw new Error(`${fileName}: array items must be objects`);
      }
      return item as Record<string, unknown>;
    }),
    fileName,
  );

  return { name: pluginNameFromFile(fileName), tools };
}

function adaptToolArray(items: Record<string, unknown>[], fileName: string): ToolDefinition[] {
  const tools: ToolDefinition[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    try {
      if (item.tool && item.runner) {
        tools.push(item as unknown as ToolDefinition);
      } else if (isOpenAIFormat(item)) {
        tools.push(fromOpenAI(item as unknown as OpenAIFunctionTool));
      } else if (isSimpleFormat(item)) {
        tools.push(fromSimple(item as unknown as SimpleTool));
      } else if (isVercelAIFormat(item)) {
        const name = (item.name as string) || `tool_${i}`;
        tools.push(fromVercelAI(item as unknown as VercelAITool, name));
      } else {
        console.error(`[kota] ${fileName}: skipping tool at index ${i} (unrecognized format)`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[kota] ${fileName}: skipping tool at index ${i}: ${msg}`);
    }
  }
  if (tools.length === 0) {
    throw new Error(`${fileName}: no valid tools found (${items.length} items were unrecognized or invalid)`);
  }
  return tools;
}

function pluginNameFromFile(fileName: string): string {
  return fileName.replace(/\.(js|mjs|ts)$/, "").replace(/[^a-zA-Z0-9_-]/g, "_");
}
