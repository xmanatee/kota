/**
 * Tool format adapters — convert common external tool formats
 * into KOTA's internal ToolDef/KotaExtension.
 *
 * Supported formats:
 * - Simple: { name, description, parameters, run }
 * - OpenAI function-calling: { type: "function", function: { name, description, parameters }, run }
 * - Vercel AI SDK: { description, parameters (Zod or JSON Schema), execute }
 * - Array of simple tools
 * - Native KotaExtension (pass-through)
 */

import type { KotaExtension, ToolDef } from "./extension-types.js";
import type { OpenAIFunctionTool, SimpleTool, VercelAITool } from "./tool-adapter-types.js";
import {
  buildInputSchema,
  extractJsonSchema,
  normalizeResult,
} from "./tool-adapters-zod.js";

export type { OpenAIFunctionTool, SimpleTool, VercelAITool } from "./tool-adapter-types.js";
export { extractJsonSchema, normalizeResult, zodDefToJsonSchema } from "./tool-adapters-zod.js";

// --- Adapters ---

/** Convert a simple tool definition to KOTA's ToolDef. */
export function fromSimple(def: SimpleTool): ToolDef {
  if (!def.name || typeof def.name !== "string") {
    throw new Error("Simple tool must have a non-empty 'name' string");
  }
  if (typeof def.run !== "function") {
    throw new Error(`Simple tool "${def.name}" must have a 'run' function`);
  }

  const tool = {
    name: def.name,
    description: def.description || "",
    input_schema: buildInputSchema(def.parameters),
  };

  const runner = async (input: Record<string, unknown>) => {
    const result = await def.run(input);
    return normalizeResult(result);
  };

  return { tool, runner, group: def.group };
}

/** Convert an OpenAI function-calling tool to KOTA's ToolDef. */
export function fromOpenAI(def: OpenAIFunctionTool): ToolDef {
  const fn = def.function;
  if (!fn?.name || typeof fn.name !== "string") {
    throw new Error("OpenAI tool must have function.name");
  }
  if (typeof def.run !== "function") {
    throw new Error(`OpenAI tool "${fn.name}" must have a 'run' function`);
  }

  const tool = {
    name: fn.name,
    description: fn.description || "",
    input_schema: buildInputSchema(fn.parameters),
  };

  const runner = async (input: Record<string, unknown>) => {
    const result = await def.run(input);
    return normalizeResult(result);
  };

  return { tool, runner, group: def.group };
}

/** Convert a Vercel AI SDK tool definition to KOTA's ToolDef. */
export function fromVercelAI(def: VercelAITool, name: string): ToolDef {
  if (typeof def.execute !== "function") {
    throw new Error(`Vercel AI SDK tool "${name}" must have an 'execute' function`);
  }

  const inputSchema = extractJsonSchema(def.parameters);

  const tool = {
    name,
    description: def.description || "",
    input_schema: buildInputSchema(
      inputSchema.type === "object" ? inputSchema : undefined,
    ),
  };

  const runner = async (input: Record<string, unknown>) => {
    const result = await def.execute(input);
    return normalizeResult(result);
  };

  return { tool, runner, group: def.group };
}

// --- Format detection ---

function isKotaExtension(obj: Record<string, unknown>): boolean {
  return typeof obj.name === "string" && (obj.tools === undefined || Array.isArray(obj.tools) || typeof obj.tools === "function");
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
 * Auto-detect the format of an extension export and convert it to KotaExtension.
 *
 * Detection order:
 * 1. Native KotaExtension (has name + tools array) → pass-through
 * 2. OpenAI function-calling (has type:"function" + function object) → adapt
 * 3. Simple tool (has name + run function) → adapt
 * 4. Array of tools (each element is simple or OpenAI) → adapt all
 *
 * Throws if the export doesn't match any recognized format.
 */
export function adaptExport(exported: unknown, fileName: string): KotaExtension {
  if (!exported || typeof exported !== "object") {
    throw new Error(`${fileName}: export is not an object or array`);
  }

  if (Array.isArray(exported)) {
    return adaptArray(exported, fileName);
  }

  const obj = exported as Record<string, unknown>;

  if (isKotaExtension(obj) && typeof obj.run !== "function") {
    if (Array.isArray(obj.tools) && obj.tools.length > 0) {
      const first = obj.tools[0] as Record<string, unknown>;
      if (first.tool && first.runner) {
        return exported as KotaExtension;
      }
      const tools = adaptToolArray(obj.tools as Record<string, unknown>[], fileName);
      return {
        name: obj.name as string,
        version: obj.version as string | undefined,
        tools,
        onLoad: obj.onLoad as KotaExtension["onLoad"],
        onUnload: obj.onUnload as KotaExtension["onUnload"],
      };
    }
    return exported as KotaExtension;
  }

  if (isOpenAIFormat(obj)) {
    const tool = fromOpenAI(obj as unknown as OpenAIFunctionTool);
    const name = extensionNameFromFile(fileName);
    return { name, tools: [tool] };
  }

  if (isSimpleFormat(obj)) {
    const tool = fromSimple(obj as unknown as SimpleTool);
    const name = (obj.name as string) || extensionNameFromFile(fileName);
    return { name, tools: [tool] };
  }

  if (isVercelAIFormat(obj)) {
    const name = extensionNameFromFile(fileName);
    const tool = fromVercelAI(obj as unknown as VercelAITool, name);
    return { name, tools: [tool] };
  }

  const entries = Object.entries(obj);
  if (entries.length > 0 && entries.every(([, v]) =>
    v && typeof v === "object" && isVercelAIFormat(v as Record<string, unknown>),
  )) {
    const tools = entries.map(([key, val]) =>
      fromVercelAI(val as unknown as VercelAITool, key),
    );
    return { name: extensionNameFromFile(fileName), tools };
  }

  throw new Error(
    `${fileName}: unrecognized export format. Expected KotaExtension, OpenAI function tool, ` +
      `simple tool { name, description, run }, Vercel AI SDK tool { execute, parameters }, ` +
      `or an array of tools.`,
  );
}

function adaptArray(arr: unknown[], fileName: string): KotaExtension {
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

  return { name: extensionNameFromFile(fileName), tools };
}

function adaptToolArray(items: Record<string, unknown>[], fileName: string): ToolDef[] {
  const tools: ToolDef[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    try {
      if (item.tool && item.runner) {
        tools.push(item as unknown as ToolDef);
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

function extensionNameFromFile(fileName: string): string {
  return fileName.replace(/\.(js|mjs|ts)$/, "").replace(/[^a-zA-Z0-9_-]/g, "_");
}
