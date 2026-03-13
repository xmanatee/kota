type ModelPricing = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
};

/** Per-million-token pricing */
const PRICING: Record<string, ModelPricing> = {
  "claude-sonnet-4-6": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  "claude-opus-4-6": { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
  "claude-haiku-4-5-20251001": { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 },
};

const DEFAULT_PRICING = PRICING["claude-sonnet-4-6"];

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

  addUsage(model: string, usage: Usage): void {
    const pricing = PRICING[model] || DEFAULT_PRICING;
    this.totalInput += usage.input_tokens;
    this.totalOutput += usage.output_tokens;
    this.totalCacheRead += usage.cache_read_input_tokens || 0;
    this.totalCacheWrite += usage.cache_creation_input_tokens || 0;

    this.totalCost +=
      (usage.input_tokens * pricing.input +
        usage.output_tokens * pricing.output +
        (usage.cache_read_input_tokens || 0) * pricing.cacheRead +
        (usage.cache_creation_input_tokens || 0) * pricing.cacheWrite) /
      1_000_000;
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
