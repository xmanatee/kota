/**
 * model-clients module config slices.
 *
 * Owns the top-level `modelProvider` and `failover` fields:
 *
 * - `modelProvider` — non-Anthropic provider configuration (OpenAI-compat,
 *   Ollama, etc.). Consumed by the model-client factory.
 * - `failover` — secondary provider used when the primary is detected as
 *   unhealthy. Consumed by the failover client wrapper.
 */

import { type ModuleConfigSlice, registerConfigSlice } from "#core/config/config-slice.js";

export type ModelProviderConfig = {
  type?: string;
  baseUrl?: string;
  apiKey?: string;
};

export type FailoverConfig = {
  /** Fallback provider name (e.g. "openai"). Required. */
  provider: string;
  /** Fallback model. Falls back to the primary model if omitted. */
  model?: string;
  /** Fallback base URL. Uses preset if omitted. */
  baseUrl?: string;
  /** Fallback API key. Resolved from env if omitted. */
  apiKey?: string;
  /** Errors in the sliding window that trigger failover. Default: 5. */
  errorThreshold?: number;
  /** Sliding window in ms. Default: 60000. */
  windowMs?: number;
  /** Cooldown before re-probing the primary, in ms. Default: 300000. */
  cooldownMs?: number;
};

declare module "#core/config/config-slice.js" {
  interface KotaModuleConfigRegistry {
    modelProvider: ModelProviderConfig;
    failover: FailoverConfig;
  }
}

function sanitizeModelProvider(raw: unknown): ModelProviderConfig | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
  const src = raw as Record<string, unknown>;
  const mp: ModelProviderConfig = {};
  if (typeof src.type === "string" && src.type) mp.type = src.type;
  if (typeof src.baseUrl === "string" && src.baseUrl) mp.baseUrl = src.baseUrl;
  if (typeof src.apiKey === "string" && src.apiKey) mp.apiKey = src.apiKey;
  return mp.type || mp.baseUrl ? mp : undefined;
}

function sanitizeFailover(raw: unknown): FailoverConfig | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
  const src = raw as Record<string, unknown>;
  if (typeof src.provider !== "string" || !src.provider) return undefined;
  const fo: FailoverConfig = { provider: src.provider };
  if (typeof src.model === "string" && src.model) fo.model = src.model;
  if (typeof src.baseUrl === "string" && src.baseUrl) fo.baseUrl = src.baseUrl;
  if (typeof src.apiKey === "string" && src.apiKey) fo.apiKey = src.apiKey;
  if (typeof src.errorThreshold === "number" && src.errorThreshold > 0 && Number.isInteger(src.errorThreshold)) fo.errorThreshold = src.errorThreshold;
  if (typeof src.windowMs === "number" && src.windowMs > 0) fo.windowMs = src.windowMs;
  if (typeof src.cooldownMs === "number" && src.cooldownMs > 0) fo.cooldownMs = src.cooldownMs;
  return fo;
}

export const modelProviderConfigSlice: ModuleConfigSlice<"modelProvider"> = {
  key: "modelProvider",
  description: "Non-Anthropic model provider (OpenAI-compat, Ollama, etc.)",
  sanitize: sanitizeModelProvider,
  merge: (base, override) => ({ ...base, ...override }),
  projectConfigSafety: "authority",
  schemaSource: {
    relativePath: "src/modules/model-clients/config-slice.ts",
    typeName: "ModelProviderConfig",
  },
};

export const failoverConfigSlice: ModuleConfigSlice<"failover"> = {
  key: "failover",
  description: "Model provider failover (secondary provider when primary is unhealthy)",
  sanitize: sanitizeFailover,
  merge: (base, override) => ({ ...base, ...override }),
  projectConfigSafety: "authority",
  schemaSource: {
    relativePath: "src/modules/model-clients/config-slice.ts",
    typeName: "FailoverConfig",
  },
};

registerConfigSlice(modelProviderConfigSlice, "model-clients");
registerConfigSlice(failoverConfigSlice, "model-clients");
