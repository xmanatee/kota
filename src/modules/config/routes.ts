import type { ServerResponse } from "node:http";
import type { KotaConfig } from "../../config.js";
import { jsonResponse } from "../../core/server/session-pool.js";

export type ConfigResponse = {
  config: unknown;
};

const SENSITIVE_KEY_PATTERN = /token|secret|password|api[_]?key/i;

function walkAndMask(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(walkAndMask);
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = SENSITIVE_KEY_PATTERN.test(k) ? "***" : walkAndMask(v);
    }
    return result;
  }
  return value;
}

export function maskConfig(config: KotaConfig): unknown {
  return walkAndMask(config);
}

export function handleGetConfig(res: ServerResponse, config: KotaConfig): void {
  jsonResponse(res, 200, { config: maskConfig(config) } satisfies ConfigResponse);
}
