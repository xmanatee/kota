import type { ModelPricing, ModelPricingProvider } from "#core/modules/provider-registry.js";
import {
	OPENROUTER_MODEL_CATALOG_OBSERVED_AT,
	OPENROUTER_MODEL_CATALOG_SOURCE_URL,
} from "./openrouter-catalog.js";

export type PricingSource = {
	provider: "anthropic" | "openai" | "google" | "openrouter";
	url: string;
	observedAt: string;
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
		url: "https://developers.openai.com/api/docs/pricing",
		observedAt: "2026-07-11",
		scope: "OpenAI API standard processing rates, including GPT-5.6 long-context and cache multipliers.",
	},
	google: {
		provider: "google",
		url: "https://ai.google.dev/gemini-api/docs/pricing",
		observedAt: "2026-05-16",
		scope: "Gemini API paid Standard tier for text/image/video token usage; Pro rates tier by prompt input tokens.",
	},
	openrouter: {
		provider: "openrouter",
		url: OPENROUTER_MODEL_CATALOG_SOURCE_URL,
		observedAt: OPENROUTER_MODEL_CATALOG_OBSERVED_AT,
		scope:
			"OpenRouter /models per-token pricing converted to per-million-token KOTA pricing rows.",
	},
} as const satisfies Record<string, PricingSource>;

function gpt56Pricing(input: number, output: number): ModelPricing {
	return {
		kind: "input-token-tiered",
		tiers: [
			{
				maxInputTokens: 272_000,
				rates: {
					input,
					output,
					cacheRead: input * 0.1,
					cacheWrite: input * 1.25,
				},
			},
			{
				maxInputTokens: null,
				rates: {
					input: input * 2,
					output: output * 1.5,
					cacheRead: input * 0.2,
					cacheWrite: input * 2.5,
				},
			},
		],
	};
}

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
	"gpt-5.6-sol": {
		kind: "priced",
		model: "gpt-5.6-sol",
		pricing: gpt56Pricing(5, 30),
		source: MODEL_PRICING_SOURCES.openai,
	},
	"gpt-5.6-terra": {
		kind: "priced",
		model: "gpt-5.6-terra",
		pricing: gpt56Pricing(2.5, 15),
		source: MODEL_PRICING_SOURCES.openai,
	},
	"gpt-5.6-luna": {
		kind: "priced",
		model: "gpt-5.6-luna",
		pricing: gpt56Pricing(1, 6),
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
	"gemini-3.1-pro": {
		kind: "unpriced",
		model: "gemini-3.1-pro",
		rationale:
			"Antigravity CLI exposes this as a native agent runtime model through quota/plan access, not the Gemini API pricing table KOTA uses for SDK token accounting.",
	},
	"gemini-3.6-flash": {
		kind: "unpriced",
		model: "gemini-3.6-flash",
		rationale:
			"Antigravity CLI exposes this as a native agent runtime model through quota/plan access, not the Gemini API pricing table KOTA uses for SDK token accounting.",
	},
	"gemini-3.7-flash": {
		kind: "unpriced",
		model: "gemini-3.7-flash",
		rationale:
			"Antigravity CLI exposes this as a native agent runtime model through quota/plan access, not the Gemini API pricing table KOTA uses for SDK token accounting.",
	},
	"openrouter/openai/gpt-4.1-mini": {
		kind: "unpriced",
		model: "openrouter/openai/gpt-4.1-mini",
		rationale:
			"OpenRouter is a provider-routed model id; KOTA does not ship a pass-through OpenRouter billing row until route-specific pricing is normalized separately from OpenAI's direct API table.",
	},
	"openrouter/deepseek/deepseek-v4-flash": {
		kind: "priced",
		model: "openrouter/deepseek/deepseek-v4-flash",
		pricing: { kind: "flat", input: 0.09, output: 0.18, cacheRead: 0.02, cacheWrite: 0 },
		source: MODEL_PRICING_SOURCES.openrouter,
	},
	"openrouter/qwen/qwen3.7-plus": {
		kind: "priced",
		model: "openrouter/qwen/qwen3.7-plus",
		pricing: { kind: "flat", input: 0.32, output: 1.28, cacheRead: 0.064, cacheWrite: 0.4 },
		source: MODEL_PRICING_SOURCES.openrouter,
	},
	"openrouter/z-ai/glm-5.2": {
		kind: "priced",
		model: "openrouter/z-ai/glm-5.2",
		pricing: { kind: "flat", input: 0.95, output: 3, cacheRead: 0.18, cacheWrite: 0 },
		source: MODEL_PRICING_SOURCES.openrouter,
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
