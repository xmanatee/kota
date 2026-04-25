import { getModelPricingProvider } from "#core/modules/provider-registry.js";

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
    this.totalInput += usage.input_tokens;
    this.totalOutput += usage.output_tokens;
    this.totalCacheRead += usage.cache_read_input_tokens || 0;
    this.totalCacheWrite += usage.cache_creation_input_tokens || 0;

    const pricing = getModelPricingProvider()?.getPricing(model) ?? null;
    if (!pricing) return;

    this.totalCost +=
      (usage.input_tokens * pricing.input +
        usage.output_tokens * pricing.output +
        (usage.cache_read_input_tokens || 0) * pricing.cacheRead +
        (usage.cache_creation_input_tokens || 0) * pricing.cacheWrite) /
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
