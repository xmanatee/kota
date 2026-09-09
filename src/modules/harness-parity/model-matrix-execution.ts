import type { AgentEffort, AgentHarness, AgentHarnessRunOptions, AgentUsage } from "#core/agent-harness/index.js";
import { apiKeyNameForProvider, PROVIDER_PRESETS, resolveApiKey } from "#modules/model-clients/factory.js";
import { getShippedModelPricingStatus } from "#modules/model-clients/pricing.js";
import type { MatrixModelSpec } from "./model-matrix-models.js";

export function matrixHarnessOverrides(
  harness: AgentHarness,
  spec: MatrixModelSpec,
  effort: AgentEffort | undefined,
): AgentHarnessRunOptions["harnessOverrides"] {
  if (harness.modelRouting?.kind !== "model-client") return undefined;
  if (effort !== undefined) {
    if (spec.executionProvider !== "anthropic" && PROVIDER_PRESETS[spec.executionProvider]?.effortTranslator === undefined) {
      throw new Error(`Provider "${spec.executionProvider}" cannot honor effort "${effort}".`);
    }
    return undefined;
  }
  return { reasoning: "provider-default" };
}

/** Resolve credentials in the source scope, before entering an isolated eval home. */
export function matrixExecutorAuthEnv(
  harness: AgentHarness,
  spec: MatrixModelSpec,
  scopeRoot: string,
): Record<string, string> {
  const adapterEnv = harness.resolveIsolatedHostAuthEnv?.(process.env) ?? {};
  const key = apiKeyNameForProvider(spec.executionProvider);
  if (!key) return { ...adapterEnv };
  const value = resolveApiKey(spec.executionProvider, undefined, { scopeRoot });
  return { ...adapterEnv, ...(value ? { [key]: value } : {}) };
}

/** Uncached flat-rate estimate only; unknown or tiered aggregate usage stays unknown. */
export function matrixEstimatedCost(model: string, usage: AgentUsage | undefined): number | null {
  if (usage?.cost.state === "complete") return usage.cost.usd;
  if (usage?.tokens.state !== "complete") return null;
  const status = getShippedModelPricingStatus(model);
  if (status?.kind !== "priced" || status.pricing.kind !== "flat") return null;
  return (usage.tokens.inputTokens * status.pricing.input + usage.tokens.outputTokens * status.pricing.output) / 1_000_000;
}
