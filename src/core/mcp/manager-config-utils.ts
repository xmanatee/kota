import type { KotaJsonObject, KotaJsonValue } from "#core/agent-harness/message-protocol.js";

export function isJsonObject(
  value: KotaJsonValue | undefined,
): value is KotaJsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function presentFields(raw: KotaJsonObject, fields: readonly string[]): string[] {
  return fields.filter((field) => raw[field] !== undefined);
}

export function assertNoUnknownObjectFields(
  label: string,
  raw: KotaJsonObject,
  fields: Set<string>,
): void {
  const unknownFields = Object.keys(raw).filter((field) => !fields.has(field));
  if (unknownFields.length === 0) return;
  throw new Error(
    `${label} has unexpected field${unknownFields.length === 1 ? "" : "s"} ${unknownFields.join(", ")}`,
  );
}

export function optionalStringArray(
  value: KotaJsonValue | undefined,
  label: string,
): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
    throw new Error(`${label} must be an array of strings`);
  }
  return [...value];
}

export function optionalStringRecord(
  value: KotaJsonValue | undefined,
  label: string,
): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (!isJsonObject(value)) {
    throw new Error(`${label} must be an object with string values`);
  }
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== "string") {
      throw new Error(`${label}.${key} must be a string`);
    }
    out[key] = entry;
  }
  return out;
}

export function requiredString(value: KotaJsonValue | undefined, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}
