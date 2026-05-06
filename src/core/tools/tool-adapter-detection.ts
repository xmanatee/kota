/**
 * Format detection for external-tool exports.
 *
 * `detectExportFormat` is the single typed parse at the external-input
 * boundary: it inspects an unknown object once and returns a discriminated
 * union over the recognized shapes (KotaModule, OpenAI function-calling,
 * simple, single Vercel AI SDK, Vercel AI SDK map). Adapter call sites
 * consume the typed `value` directly; the lenient predicates here let the
 * detailed validation live in the constructors (`fromSimple`, `fromOpenAI`,
 * `fromVercelAI`), which throw on malformed inputs after a branch is
 * selected.
 */

import type { KotaModule, ToolDef } from "#core/modules/module-types.js";
import type { OpenAIFunctionTool, SimpleTool, VercelAITool } from "./tool-adapter-types.js";

/**
 * KotaModule-shaped export: a `name` string plus a `tools` field that is
 * undefined, an array, or a factory, and no top-level `run` function (which
 * would mark the value as a simple tool). The element types in `tools` are
 * not validated here; the adapter path separately distinguishes already-built
 * `ToolDef[]` (pass-through) from external-format items that need per-item
 * adaptation.
 */
export type KotaModuleShape = Pick<
  KotaModule,
  "name" | "version" | "description" | "tools" | "onLoad" | "onUnload"
>;

/** Discriminated union over recognized external-tool export shapes. */
export type DetectedExportFormat =
  | { kind: "kota-module"; value: KotaModuleShape }
  | { kind: "openai"; value: OpenAIFunctionTool }
  | { kind: "simple"; value: SimpleTool }
  | { kind: "vercel-ai"; value: VercelAITool }
  | { kind: "vercel-ai-map"; entries: ReadonlyArray<readonly [string, VercelAITool]> };

/**
 * Lenient structural detection: returns the first matching shape, or null
 * if no recognized format applies.
 */
export function detectExportFormat(obj: Record<string, unknown>): DetectedExportFormat | null {
  if (isKotaModuleShape(obj)) return { kind: "kota-module", value: obj };
  if (isOpenAIFormat(obj)) return { kind: "openai", value: obj };
  if (isSimpleFormat(obj)) return { kind: "simple", value: obj };
  if (isVercelAIFormat(obj)) return { kind: "vercel-ai", value: obj };

  const entries = Object.entries(obj);
  if (entries.length === 0) return null;
  const map: Array<readonly [string, VercelAITool]> = [];
  for (const [k, v] of entries) {
    if (v === null || typeof v !== "object") return null;
    const candidate = v as Record<string, unknown>;
    if (!isVercelAIFormat(candidate)) return null;
    map.push([k, candidate]);
  }
  return { kind: "vercel-ai-map", entries: map };
}

export function isKotaModuleShape(obj: Record<string, unknown>): obj is KotaModuleShape {
  if (typeof obj.name !== "string") return false;
  if (typeof obj.run === "function") return false;
  const t = obj.tools;
  return t === undefined || Array.isArray(t) || typeof t === "function";
}

export function isOpenAIFormat(obj: Record<string, unknown>): obj is OpenAIFunctionTool {
  return obj.type === "function" && typeof obj.function === "object" && obj.function !== null;
}

export function isSimpleFormat(obj: Record<string, unknown>): obj is SimpleTool {
  return typeof obj.name === "string" && typeof obj.run === "function";
}

export function isVercelAIFormat(obj: Record<string, unknown>): obj is VercelAITool {
  return typeof obj.execute === "function" && obj.parameters != null && typeof obj.run !== "function";
}

export function isToolDefShape(obj: Record<string, unknown>): obj is ToolDef {
  return obj.tool !== undefined && typeof obj.runner === "function";
}
