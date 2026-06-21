import { existsSync, readFileSync } from "node:fs";

type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

function stableStringify(value: JsonValue): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  const objectValue = value as { readonly [key: string]: JsonValue };
  return `{${Object.keys(objectValue)
    .sort((a, b) => a.localeCompare(b))
    .map(
      (key) =>
        `${JSON.stringify(key)}:${stableStringify(objectValue[key] ?? null)}`,
    )
    .join(",")}}`;
}

function stableComparable(value: object): string {
  return stableStringify(JSON.parse(JSON.stringify(value)) as JsonValue);
}

export function sameStructuredValue(a: object, b: object): boolean {
  return stableComparable(a) === stableComparable(b);
}

export function readJsonFile<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch {
    return null;
  }
}

export function uniqueSorted(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}
