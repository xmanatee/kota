import { readFileSync } from "node:fs";
import type { JsonObject, JsonValue } from "./fixture-candidates-types.js";

export function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asArray(value: JsonValue | undefined): readonly JsonValue[] {
  return Array.isArray(value) ? value : [];
}

export function readJsonValue(path: string): JsonValue {
  return JSON.parse(readFileSync(path, "utf-8")) as JsonValue;
}

export function parseString(value: JsonValue | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function parseStringArray(value: JsonValue | undefined): readonly string[] {
  return asArray(value).filter((entry): entry is string => typeof entry === "string");
}

export function parseNullableString(value: JsonValue | undefined): string | null {
  if (typeof value === "string") return value;
  return null;
}
