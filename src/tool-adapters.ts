/**
 * Tool format adapters — convert common external tool formats
 * into KOTA's internal ToolDefinition/KotaPlugin.
 *
 * Supported formats:
 * - Simple: { name, description, parameters, run }
 * - OpenAI function-calling: { type: "function", function: { name, description, parameters }, run }
 * - Array of simple tools
 * - Native KotaPlugin (pass-through)
 */

import type Anthropic from "@anthropic-ai/sdk";
import type { ToolDefinition, KotaPlugin } from "./plugin-types.js";
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
    return { content: JSON.stringify(value, null, 2) };
  }
  // Numbers, booleans, etc.
  return { content: String(value) };
}

// --- Adapters ---

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
    input_schema: {
      type: "object" as const,
      ...(def.parameters ?? { properties: {} }),
    },
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
    input_schema: {
      type: "object" as const,
      ...(fn.parameters ?? { properties: {} }),
    },
  };

  const runner = async (input: Record<string, unknown>): Promise<ToolResult> => {
    const result = await def.run(input);
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

  throw new Error(
    `${fileName}: unrecognized export format. Expected KotaPlugin, OpenAI function tool, ` +
      `simple tool { name, description, run }, or an array of tools.`,
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
  return items.map((item, i) => {
    // Already a ToolDefinition
    if (item.tool && item.runner) {
      return item as unknown as ToolDefinition;
    }
    if (isOpenAIFormat(item)) {
      return fromOpenAI(item as unknown as OpenAIFunctionTool);
    }
    if (isSimpleFormat(item)) {
      return fromSimple(item as unknown as SimpleTool);
    }
    throw new Error(`${fileName}: tool at index ${i} is not in a recognized format`);
  });
}

function pluginNameFromFile(fileName: string): string {
  return fileName.replace(/\.(js|mjs|ts)$/, "").replace(/[^a-zA-Z0-9_-]/g, "_");
}
