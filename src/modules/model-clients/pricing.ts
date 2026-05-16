import type { ModelPricing, ModelPricingProvider } from "#core/modules/provider-registry.js";

export type PricingSource = {
	provider: "anthropic" | "openai" | "google";
	url: string;
	observedAt: "2026-05-16";
	scope: string;
};

export type ShippedModelPricingStatus =
	| {
			kind: "priced";
			model: string;
			pricing: ModelPricing;
			source: PricingSource;
	  }
	| {
			kind: "unpriced";
			model: string;
			rationale: string;
			source?: PricingSource;
	  };

export const MODEL_PRICING_SOURCES = {
	anthropic: {
		provider: "anthropic",
		url: "https://platform.claude.com/docs/en/about-claude/pricing",
		observedAt: "2026-05-16",
		scope: "Claude API standard global pricing; cacheWrite uses the 5-minute cache write column.",
	},
	openai: {
		provider: "openai",
		url: "https://openai.com/api/pricing/",
		observedAt: "2026-05-16",
		scope: "OpenAI API standard processing rates for context lengths under 270K tokens.",
	},
	google: {
		provider: "google",
		url: "https://ai.google.dev/gemini-api/docs/pricing",
		observedAt: "2026-05-16",
		scope: "Gemini API paid Standard tier for text/image/video token usage; Pro rates tier by prompt input tokens.",
	},
} as const satisfies Record<string, PricingSource>;

const SHIPPED_MODEL_PRICING_STATUS: Record<string, ShippedModelPricingStatus> = {
	"claude-sonnet-4-6": {
		kind: "priced",
		model: "claude-sonnet-4-6",
		pricing: { kind: "flat", input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
		source: MODEL_PRICING_SOURCES.anthropic,
	},
	"claude-opus-4-7": {
		kind: "priced",
		model: "claude-opus-4-7",
		pricing: { kind: "flat", input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
		source: MODEL_PRICING_SOURCES.anthropic,
	},
	"claude-haiku-4-5-20251001": {
		kind: "priced",
		model: "claude-haiku-4-5-20251001",
		pricing: { kind: "flat", input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
		source: MODEL_PRICING_SOURCES.anthropic,
	},
	"gpt-5.5": {
		kind: "priced",
		model: "gpt-5.5",
		pricing: { kind: "flat", input: 5, output: 30, cacheRead: 0.5, cacheWrite: 5 },
		source: MODEL_PRICING_SOURCES.openai,
	},
	"gpt-5.4": {
		kind: "priced",
		model: "gpt-5.4",
		pricing: { kind: "flat", input: 2.5, output: 15, cacheRead: 0.25, cacheWrite: 2.5 },
		source: MODEL_PRICING_SOURCES.openai,
	},
	"gpt-5.4-mini": {
		kind: "priced",
		model: "gpt-5.4-mini",
		pricing: { kind: "flat", input: 0.75, output: 4.5, cacheRead: 0.075, cacheWrite: 0.75 },
		source: MODEL_PRICING_SOURCES.openai,
	},
	"gemini-2.5-pro": {
		kind: "priced",
		model: "gemini-2.5-pro",
		pricing: {
			kind: "input-token-tiered",
			tiers: [
				{
					maxInputTokens: 200_000,
					rates: { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 1.25 },
				},
				{
					maxInputTokens: null,
					rates: { input: 2.5, output: 15, cacheRead: 0.25, cacheWrite: 2.5 },
				},
			],
		},
		source: MODEL_PRICING_SOURCES.google,
	},
	"gemini-2.5-flash": {
		kind: "priced",
		model: "gemini-2.5-flash",
		pricing: { kind: "flat", input: 0.3, output: 2.5, cacheRead: 0.03, cacheWrite: 0.3 },
		source: MODEL_PRICING_SOURCES.google,
	},
	"gemini-2.5-flash-lite": {
		kind: "priced",
		model: "gemini-2.5-flash-lite",
		pricing: { kind: "flat", input: 0.1, output: 0.4, cacheRead: 0.01, cacheWrite: 0.1 },
		source: MODEL_PRICING_SOURCES.google,
	},
};

class ShippedModelPricingProvider implements ModelPricingProvider {
	getPricing(model: string): ModelPricing | null {
		const status = SHIPPED_MODEL_PRICING_STATUS[model] ?? null;
		return status?.kind === "priced" ? status.pricing : null;
	}
}

export function getShippedModelPricingStatus(model: string): ShippedModelPricingStatus | null {
	return SHIPPED_MODEL_PRICING_STATUS[model] ?? null;
}

export function listShippedModelPricingStatuses(): readonly ShippedModelPricingStatus[] {
	return Object.values(SHIPPED_MODEL_PRICING_STATUS);
}

export function createShippedModelPricingProvider(): ModelPricingProvider {
	return new ShippedModelPricingProvider();
}
