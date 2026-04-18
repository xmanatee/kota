/**
 * Autonomy mode — session-level supervision axis for tool execution.
 *
 * Every session carries an explicit autonomy mode chosen at creation time. The
 * mode is orthogonal to per-tool risk classification: it describes how much
 * operator supervision the session runs under, regardless of which tools the
 * agent tries to use. The tool-runner consults the mode before any other
 * guardrail so that a supervised or passive session cannot be bypassed by a
 * tool that happens to be classified as moderate.
 *
 * - `passive`     — read-only. Any non-safe tool call is denied outright.
 * - `supervised`  — every non-safe tool call is queued for human approval,
 *                   regardless of its risk classification.
 * - `autonomous`  — today's behavior: per-tool guardrail policy decides.
 */
import type { Assessment, GuardrailsConfig } from "./guardrails.js";

export type AutonomyMode = "passive" | "supervised" | "autonomous";

export const AUTONOMY_MODES: readonly AutonomyMode[] = [
  "passive",
  "supervised",
  "autonomous",
] as const;

export function isAutonomyMode(value: unknown): value is AutonomyMode {
  return value === "passive" || value === "supervised" || value === "autonomous";
}

export type AutonomyGateDecision =
  | { action: "allow" }
  | { action: "deny"; message: string }
  | { action: "queue"; reason: string };

/**
 * Resolve what a session's autonomy mode wants to do with a tool call, given
 * the tool-risk assessment computed by the guardrails layer. Returns "allow"
 * for the pass-through case so the existing guardrails policy decides; returns
 * "deny" or "queue" when the mode needs to override policy with stricter
 * gating. Safe (read-only) tools always pass through so that operators on
 * passive or supervised sessions can still inspect state.
 */
export function resolveAutonomyGate(
  mode: AutonomyMode,
  assessment: Assessment,
): AutonomyGateDecision {
  if (assessment.risk === "safe") return { action: "allow" };
  if (mode === "autonomous") return { action: "allow" };
  if (mode === "passive") {
    return {
      action: "deny",
      message:
        `Blocked by autonomy mode "passive": ${assessment.tool} is classified as ${assessment.risk}. ` +
        "Passive sessions run read-only — start a supervised or autonomous session to perform writes.",
    };
  }
  return {
    action: "queue",
    reason: `autonomy mode "supervised" gates ${assessment.risk} tool calls through human approval`,
  };
}

/**
 * Guardrails config used when a session runs in supervised mode. The mode gates
 * non-safe tools at the session level, but we still want the underlying policy
 * layer to treat those calls as queueable so the approval-queue receives them
 * with the right classification. Passive mode denies before reaching guardrails,
 * so it does not need a bespoke config.
 */
export function supervisedGuardrailsConfig(
  base: GuardrailsConfig,
): GuardrailsConfig {
  return {
    ...base,
    policies: {
      safe: base.policies.safe,
      moderate: "queue",
      dangerous: "queue",
    },
  };
}
