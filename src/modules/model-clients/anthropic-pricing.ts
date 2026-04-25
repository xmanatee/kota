import type { ModelPricing, ModelPricingProvider } from "#core/modules/provider-registry.js";

/**
 * Per-million-token rates for the Claude models KOTA actively ships against.
 * Owned by this module — core no longer carries any provider's pricing rows.
 * Adding a new Claude model means adding a row here, not editing core.
 */
const ANTHROPIC_PRICING: Record<string, ModelPricing> = {
	"claude-sonnet-4-6": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
	"claude-opus-4-7": { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
	"claude-haiku-4-5-20251001": { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 },
};

class AnthropicModelPricingProvider implements ModelPricingProvider {
	getPricing(model: string): ModelPricing | null {
		return ANTHROPIC_PRICING[model] ?? null;
	}
}

export function createAnthropicModelPricingProvider(): ModelPricingProvider {
	return new AnthropicModelPricingProvider();
}
