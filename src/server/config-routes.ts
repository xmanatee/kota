import type { ServerResponse } from "node:http";
import type { KotaConfig } from "../config.js";
import { jsonResponse } from "./session-pool.js";

export type ConfigResponse = {
  config: unknown;
};

const SENSITIVE_KEY_PATTERN = /token|secret|password|api_key/i;

function maskSensitive(value: unknown): unknown {
  if (typeof value === "string") return "***";
  if (Array.isArray(value)) return value.map(maskSensitive);
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = SENSITIVE_KEY_PATTERN.test(k) ? "***" : maskSensitive(v);
    }
    return result;
  }
  return value;
}

export function maskConfig(config: KotaConfig): unknown {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(config as Record<string, unknown>)) {
    result[k] = SENSITIVE_KEY_PATTERN.test(k) ? "***" : maskSensitive(v);
  }
  return result;
}

export function handleGetConfig(res: ServerResponse, config: KotaConfig): void {
  jsonResponse(res, 200, { config: maskConfig(config) } satisfies ConfigResponse);
}
