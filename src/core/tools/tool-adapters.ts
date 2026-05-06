/**
 * Tool format adapters — convert common external tool formats
 * into KOTA's internal ToolDef/KotaModule.
 *
 * Supported formats:
 * - Simple: { name, description, parameters, run }
 * - OpenAI function-calling: { type: "function", function: { name, description, parameters }, run }
 * - Vercel AI SDK: { description, parameters (Zod or JSON Schema), execute }
 * - Array of simple tools
 * - Native KotaModule (pass-through)
 *
 * Format detection happens once at the boundary in `detectExportFormat`
 * (sibling file). Adapter call sites consume typed values from the
 * discriminated union directly; the structural-narrowing view of `exported`
 * stays at the external-input edge where it belongs.
 */

import type { KotaModule, ToolDef } from "#core/modules/module-types.js";
import { legacyEffect } from "./effect.js";
import {
  detectExportFormat,
  isOpenAIFormat,
  isSimpleFormat,
  isToolDefShape,
  isVercelAIFormat,
  type KotaModuleShape,
} from "./tool-adapter-detection.js";
import type { OpenAIFunctionTool, SimpleTool, VercelAITool } from "./tool-adapter-types.js";
import {
  buildInputSchema,
  extractJsonSchema,
  normalizeResult,
} from "./tool-adapters-zod.js";

export {
  type DetectedExportFormat,
  detectExportFormat,
  type KotaModuleShape,
} from "./tool-adapter-detection.js";
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

  return {
    tool,
    runner,
    group: def.group,
    effect: legacyEffect({ risk: def.risk ?? "moderate", kind: def.kind ?? "action" }),
  };
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

  return {
    tool,
    runner,
    group: def.group,
    effect: legacyEffect({ risk: def.risk ?? "moderate", kind: def.kind ?? "action" }),
  };
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

  return {
    tool,
    runner,
    group: def.group,
    effect: legacyEffect({ risk: def.risk ?? "moderate", kind: def.kind ?? "action" }),
  };
}

/**
 * Auto-detect the format of a module export and convert it to KotaModule.
 *
 * Detection order is `detectExportFormat`'s order: kota-module, openai,
 * simple, vercel-ai, vercel-ai-map. Arrays are handled separately.
 *
 * Throws if the export doesn't match any recognized format.
 */
export function adaptExport(exported: unknown, fileName: string): KotaModule {
  if (!exported || typeof exported !== "object") {
    throw new Error(`${fileName}: export is not an object or array`);
  }

  if (Array.isArray(exported)) {
    return adaptArray(exported, fileName);
  }

  const obj = exported as Record<string, unknown>;
  const detected = detectExportFormat(obj);
  if (!detected) {
    throw new Error(
      `${fileName}: unrecognized export format. Expected KotaModule, OpenAI function tool, ` +
        `simple tool { name, description, run }, Vercel AI SDK tool { execute, parameters }, ` +
        `or an array of tools.`,
    );
  }

  switch (detected.kind) {
    case "kota-module":
      return adaptKotaModule(detected.value, fileName);
    case "openai": {
      const tool = fromOpenAI(detected.value);
      return { name: moduleNameFromFile(fileName), tools: [tool] };
    }
    case "simple": {
      const tool = fromSimple(detected.value);
      return { name: detected.value.name || moduleNameFromFile(fileName), tools: [tool] };
    }
    case "vercel-ai": {
      const name = moduleNameFromFile(fileName);
      const tool = fromVercelAI(detected.value, name);
      return { name, tools: [tool] };
    }
    case "vercel-ai-map":
      return {
        name: moduleNameFromFile(fileName),
        tools: detected.entries.map(([key, val]) => fromVercelAI(val, key)),
      };
  }
}

function adaptKotaModule(mod: KotaModuleShape, fileName: string): KotaModule {
  if (Array.isArray(mod.tools) && mod.tools.length > 0) {
    const first = mod.tools[0];
    if (first && typeof first === "object" && isToolDefShape(first as Record<string, unknown>)) {
      return mod;
    }
    const items = coerceItemsToObjects(mod.tools, fileName);
    const tools = adaptToolArray(items, fileName);
    return {
      name: mod.name,
      version: mod.version,
      description: mod.description,
      tools,
      onLoad: mod.onLoad,
      onUnload: mod.onUnload,
    };
  }
  return mod;
}

function adaptArray(arr: ReadonlyArray<unknown>, fileName: string): KotaModule {
  if (arr.length === 0) {
    throw new Error(`${fileName}: empty tool array`);
  }
  const items = coerceItemsToObjects(arr, fileName);
  const tools = adaptToolArray(items, fileName);
  return { name: moduleNameFromFile(fileName), tools };
}

function coerceItemsToObjects(
  items: ReadonlyArray<unknown>,
  fileName: string,
): Record<string, unknown>[] {
  return items.map((item) => {
    if (!item || typeof item !== "object") {
      throw new Error(`${fileName}: array items must be objects`);
    }
    return item as Record<string, unknown>;
  });
}

function adaptToolArray(
  items: ReadonlyArray<Record<string, unknown>>,
  fileName: string,
): ToolDef[] {
  const tools: ToolDef[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const fallbackName = typeof item.name === "string" ? item.name : `tool_${i}`;
    try {
      if (isToolDefShape(item)) {
        tools.push(item);
      } else if (isOpenAIFormat(item)) {
        tools.push(fromOpenAI(item));
      } else if (isSimpleFormat(item)) {
        tools.push(fromSimple(item));
      } else if (isVercelAIFormat(item)) {
        tools.push(fromVercelAI(item, fallbackName));
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

function moduleNameFromFile(fileName: string): string {
  return fileName.replace(/\.(js|mjs|ts)$/, "").replace(/[^a-zA-Z0-9_-]/g, "_");
}
