import type { ToolRunner } from "#core/tools/index.js";

type ToolInputValue = Parameters<ToolRunner>[0][string];

export function normalizePositiveNumber(
  raw: ToolInputValue,
  fallback: number,
): number {
  return typeof raw === "number" && Number.isFinite(raw) && raw > 0
    ? raw
    : fallback;
}

export function normalizeNonNegativeInteger(
  raw: ToolInputValue,
  fallback: number,
): number {
  return typeof raw === "number" && Number.isFinite(raw) && raw >= 0
    ? Math.floor(raw)
    : fallback;
}
