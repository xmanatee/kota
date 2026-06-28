import type {
  KotaJsonObject,
  KotaJsonValue,
} from "#core/agent-harness/message-protocol.js";
import { TRAJECTORY_TOOL_RESULT_CONTENT_LIMIT } from "./runner-constants.js";

export type SanitizedJsonValue = {
  value: KotaJsonValue;
  truncatedFields: string[];
};

export type SanitizedJsonObject = {
  value: KotaJsonObject;
  truncatedFields: string[];
};

export function truncateField(value: string, limit: number): {
  value: string;
  truncated: boolean;
} {
  if (value.length <= limit) return { value, truncated: false };
  return {
    value:
      `${value.slice(0, limit)}\n` +
      `[... ${value.length - limit} chars truncated from trajectory field ...]`,
    truncated: true,
  };
}

export function truncateStringField(value: string, path: string): {
  value: string;
  truncatedFields: string[];
} {
  const truncated = truncateField(value, TRAJECTORY_TOOL_RESULT_CONTENT_LIMIT);
  return {
    value: truncated.value,
    truncatedFields: truncated.truncated ? [path] : [],
  };
}

export function sanitizeJsonObject(
  value: KotaJsonObject,
  path: string,
): SanitizedJsonObject {
  const object: KotaJsonObject = {};
  const truncatedFields: string[] = [];
  for (const key of Object.keys(value)) {
    const sanitized = sanitizeJsonValue(value[key], `${path}.${key}`);
    object[key] = sanitized.value;
    truncatedFields.push(...sanitized.truncatedFields);
  }
  return { value: object, truncatedFields };
}

export function sanitizeJsonValue(
  value: KotaJsonValue,
  path: string,
): SanitizedJsonValue {
  if (typeof value === "string") return truncateStringField(value, path);
  if (Array.isArray(value)) {
    const truncatedFields: string[] = [];
    const values: KotaJsonValue[] = [];
    for (const [index, item] of value.entries()) {
      const sanitized = sanitizeJsonValue(item, `${path}[${index}]`);
      values.push(sanitized.value);
      truncatedFields.push(...sanitized.truncatedFields);
    }
    return { value: values, truncatedFields };
  }
  if (value !== null && typeof value === "object") {
    return sanitizeJsonObject(value, path);
  }
  return { value, truncatedFields: [] };
}
