/**
 * Schema and result utilities for tool adapters.
 *
 * - normalizeResult: Convert arbitrary tool return values to KOTA's ToolResult format.
 * - buildInputSchema: Build a valid Anthropic input_schema from external parameters.
 * - extractJsonSchema: Extract a JSON Schema from Vercel AI SDK / Zod / raw JSON Schema params.
 * - zodDefToJsonSchema: Recursively convert a Zod schema's _def to JSON Schema.
 */

import type Anthropic from "@anthropic-ai/sdk";
import type { ToolResult } from "./tools/tool-result.js";

/** Convert arbitrary tool return values to KOTA's ToolResult format. */
export function normalizeResult(value: unknown): ToolResult {
  if (value === null || value === undefined) {
    return { content: "" };
  }
  if (typeof value === "string") {
    return { content: value };
  }
  if (typeof value === "object") {
    if (value instanceof Error) {
      return { content: value.message || String(value) };
    }
    const obj = value as Record<string, unknown>;
    if (typeof obj.content === "string") {
      return value as ToolResult;
    }
    if (typeof obj.text === "string") {
      return { content: obj.text };
    }
    try {
      return { content: JSON.stringify(value, null, 2) };
    } catch {
      return { content: "[object — could not serialize (circular reference or non-serializable)]" };
    }
  }
  return { content: String(value) };
}

/**
 * Build a valid Anthropic input_schema from external parameters.
 * Anthropic requires type:"object" — external schemas may have wrong type or
 * be missing `properties`. This ensures the result is always valid.
 */
export function buildInputSchema(params?: Record<string, unknown>): Anthropic.Tool.InputSchema {
  const base = params ?? {};
  return {
    ...base,
    type: "object" as const,
    properties: (base.properties as Record<string, unknown>) ?? {},
  };
}

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

  if (p.jsonSchema && typeof p.jsonSchema === "object") {
    return p.jsonSchema as Record<string, unknown>;
  }

  if (typeof p.type === "string") {
    return p;
  }

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
    case "ZodOptional": {
      const inner = zodDefToJsonSchema(def.innerType);
      if (desc && !inner.description) inner.description = desc;
      return inner;
    }
    case "ZodNullable": {
      const inner = zodDefToJsonSchema(def.innerType);
      if (desc && !inner.description) inner.description = desc;
      if (typeof inner.type === "string") {
        return { ...inner, type: [inner.type, "null"] };
      }
      return inner;
    }
    case "ZodDefault": {
      const inner = zodDefToJsonSchema(def.innerType);
      if (desc && !inner.description) inner.description = desc;
      if (typeof def.defaultValue === "function") {
        try { inner.default = (def.defaultValue as () => unknown)(); } catch { /* skip */ }
      }
      return inner;
    }
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
