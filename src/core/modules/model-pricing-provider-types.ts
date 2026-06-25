export type ModelPricingRates = {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
};

/** A single-rate model whose token categories do not vary by prompt size. */
export type FlatModelPricing = ModelPricingRates & {
	kind: "flat";
};

/** One prompt-size tier for providers whose rates change by input tokens. */
export type InputTokenPricingTier = {
	/** Inclusive upper bound. `null` is the final unbounded tier. */
	maxInputTokens: number | null;
	rates: ModelPricingRates;
};

/**
 * A model whose input/output/cache rates are selected from the prompt's input
 * token count. The first matching tier wins; malformed gaps fail loudly in
 * CostTracker instead of silently picking an arbitrary row.
 */
export type InputTokenTieredModelPricing = {
	kind: "input-token-tiered";
	tiers: readonly [InputTokenPricingTier, ...InputTokenPricingTier[]];
};

/** Per-million-token pricing for a single model. */
export type ModelPricing = FlatModelPricing | InputTokenTieredModelPricing;

/**
 * Lookup contract for per-model token pricing. Module-owned: each
 * model-client module that ships pricing for its providers registers an
 * implementation through the typed `MODEL_PRICING_PROVIDER_TOKEN` from
 * `#core/modules/provider-registry.js`.
 *
 * Returns `null` for any model id without a registered pricing row. Core
 * `CostTracker.addUsage` treats that null as an explicit zero-cost record
 * (no silent Sonnet-rate or peer-model fallback) so missing pricing surfaces
 * as a $0 contribution rather than an inflated approximation.
 */
export interface ModelPricingProvider {
	getPricing(model: string): ModelPricing | null;
}

/** Filter accepted by `HistoryProvider.semanticSearch`. */
