/**
 * Guardrails — policy enforcement for all tool calls.
 *
 * Every tool call is assessed for risk before execution. The policy determines
 * whether to allow, require confirmation, or deny the call. Configurable via
 * .kota/config.json. Non-interactive contexts (server, telegram, daemon) use
 * stricter defaults.
 */

import type { RiskLevel } from "./guardrails-classify.js";
import { classifyRisk } from "./guardrails-classify.js";

export type { RiskLevel };
export { classifyRisk };

export type Policy = "allow" | "confirm" | "deny" | "queue";

export type GuardrailsConfig = {
  /** Policy applied at each risk level. */
  policies: Record<RiskLevel, Policy>;
  /** Override policy for specific tool names (bypasses risk classification). */
  toolOverrides?: Record<string, Policy>;
  /** TTL in ms for approval requests created in this context. Stored on each queued item. */
  approvalTimeoutMs?: number;
};

export type Assessment = {
  tool: string;
  risk: RiskLevel;
  policy: Policy;
  reason: string;
};

// ─── Default configuration ────────────────────────────────────────────

const DEFAULT_POLICIES: Record<RiskLevel, Policy> = {
  safe: "allow",
  moderate: "allow",
  dangerous: "confirm",
};

const DEFAULT_CONFIG: GuardrailsConfig = {
  policies: { ...DEFAULT_POLICIES },
};

// ─── Policy resolution ────────────────────────────────────────────────

/** Determine the policy for a tool call given config and risk assessment. */
export function resolvePolicy(
  name: string,
  risk: RiskLevel,
  config: GuardrailsConfig,
): Policy {
  // Tool-level override takes precedence
  if (config.toolOverrides?.[name]) {
    return config.toolOverrides[name];
  }
  return config.policies[risk] ?? DEFAULT_POLICIES[risk];
}

// ─── Assessment (public API) ──────────────────────────────────────────

/** Assess a tool call: classify risk and resolve policy. */
export function assess(
  name: string,
  input: Record<string, unknown>,
  config?: GuardrailsConfig,
): Assessment {
  const effectiveConfig = config ?? DEFAULT_CONFIG;
  const { risk, reason } = classifyRisk(name, input);
  const policy = resolvePolicy(name, risk, effectiveConfig);
  return { tool: name, risk, policy, reason };
}

// ─── Stricter defaults for non-interactive contexts ───────────────────

/** Policies for autonomous/non-interactive contexts (server, telegram, daemon). */
export const NON_INTERACTIVE_POLICIES: Record<RiskLevel, Policy> = {
  safe: "allow",
  moderate: "allow",
  dangerous: "queue",
};

export function nonInteractiveConfig(
  base?: GuardrailsConfig,
): GuardrailsConfig {
  return {
    policies: { ...NON_INTERACTIVE_POLICIES },
    toolOverrides: base?.toolOverrides,
    ...(base?.approvalTimeoutMs !== undefined && { approvalTimeoutMs: base.approvalTimeoutMs }),
  };
}

// ─── Config helpers ───────────────────────────────────────────────────

export function getDefaultConfig(): GuardrailsConfig {
  return { ...DEFAULT_CONFIG, policies: { ...DEFAULT_POLICIES } };
}

/** Validate and sanitize a raw guardrails config object from JSON. */
export function sanitizeGuardrailsConfig(
  raw: Record<string, unknown>,
): GuardrailsConfig | null {
  if (typeof raw !== "object" || raw === null) return null;

  const config: GuardrailsConfig = { policies: { ...DEFAULT_POLICIES } };

  if (typeof raw.policies === "object" && raw.policies !== null) {
    const p = raw.policies as Record<string, unknown>;
    for (const level of ["safe", "moderate", "dangerous"] as RiskLevel[]) {
      const val = p[level];
      if (val === "allow" || val === "confirm" || val === "deny" || val === "queue") {
        config.policies[level] = val;
      }
    }
  }

  if (typeof raw.toolOverrides === "object" && raw.toolOverrides !== null) {
    const overrides: Record<string, Policy> = {};
    for (const [key, val] of Object.entries(raw.toolOverrides as Record<string, unknown>)) {
      if (val === "allow" || val === "confirm" || val === "deny" || val === "queue") {
        overrides[key] = val;
      }
    }
    if (Object.keys(overrides).length > 0) {
      config.toolOverrides = overrides;
    }
  }

  if (typeof raw.approvalTimeoutMs === "number" && raw.approvalTimeoutMs > 0) {
    config.approvalTimeoutMs = raw.approvalTimeoutMs;
  }

  return config;
}
