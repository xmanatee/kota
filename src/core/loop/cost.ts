import {
  getModelPricingProvider,
  type ModelPricing,
  type ModelPricingRates,
} from "#core/modules/provider-registry.js";

type Usage = {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
};

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function selectPricingRates(pricing: ModelPricing, inputTokens: number): ModelPricingRates {
  if (pricing.kind === "flat") return pricing;
  for (const tier of pricing.tiers) {
    if (tier.maxInputTokens === null || inputTokens <= tier.maxInputTokens) {
      return tier.rates;
    }
  }
  throw new Error(
    `Tiered model pricing does not cover ${inputTokens} input token(s).`,
  );
}

export class CostTracker {
  private totalInput = 0;
  private totalOutput = 0;
  private totalCacheRead = 0;
  private totalCacheWrite = 0;
  private totalCost = 0;

  /**
   * Token tallies always accumulate. Dollar cost only accumulates for models
   * with a registered pricing row from the active model-pricing provider —
   * unknown models contribute $0 by design (no silent Sonnet-rate fallback).
   */
  addUsage(model: string, usage: Usage): void {
    const cacheReadTokens = usage.cache_read_input_tokens || 0;
    const cacheWriteTokens = usage.cache_creation_input_tokens || 0;
    this.totalInput += usage.input_tokens;
    this.totalOutput += usage.output_tokens;
    this.totalCacheRead += cacheReadTokens;
    this.totalCacheWrite += cacheWriteTokens;

    const pricing = getModelPricingProvider()?.getPricing(model) ?? null;
    if (!pricing) return;
    const rates = selectPricingRates(
      pricing,
      usage.input_tokens + cacheReadTokens + cacheWriteTokens,
    );

    this.totalCost +=
      (usage.input_tokens * rates.input +
        usage.output_tokens * rates.output +
        cacheReadTokens * rates.cacheRead +
        cacheWriteTokens * rates.cacheWrite) /
      1_000_000;
  }

  /** Add a pre-computed dollar cost (e.g. from Agent SDK's total_cost_usd). */
  addRawCost(usd: number): void {
    this.totalCost += usd;
  }

  getTotalCost(): number {
    return this.totalCost;
  }

  getSummary(): string {
    const cost = `$${this.totalCost.toFixed(4)}`;
    const parts = [`${formatTokens(this.totalInput)} in`, `${formatTokens(this.totalOutput)} out`];
    if (this.totalCacheRead > 0) parts.push(`${formatTokens(this.totalCacheRead)} cache`);
    return `${cost} (${parts.join(", ")})`;
  }
}
