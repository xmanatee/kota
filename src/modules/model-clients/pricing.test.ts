import { describe, expect, it } from "vitest";
import { listShippedPresets } from "#core/model/preset.js";
import {
	createShippedModelPricingProvider,
	getShippedModelPricingStatus,
	listShippedModelPricingStatuses,
	MODEL_PRICING_SOURCES,
} from "./pricing.js";

const TARGET_NON_ANTHROPIC_MODELS = [
	"gpt-5.5",
	"gpt-5.4",
	"gpt-5.4-mini",
	"gemini-2.5-pro",
	"gemini-2.5-flash",
	"gemini-2.5-flash-lite",
] as const;

function listShippedPresetModelIds(): string[] {
	return [
		...new Set(
			listShippedPresets().flatMap((preset) => [
				preset.defaultModel,
				preset.tiers.fast,
				preset.tiers.balanced,
				preset.tiers.capable,
			]),
		),
	].sort();
}

describe("shipped model pricing provider", () => {
	it("enumerates every shipped preset model id with pricing coverage or explicit unpriced status", () => {
		const missing: string[] = [];
		const unpricedWithoutRationale: string[] = [];

		for (const model of listShippedPresetModelIds()) {
			const status = getShippedModelPricingStatus(model);
			if (!status) {
				missing.push(model);
				continue;
			}
			if (status.kind === "unpriced" && status.rationale.trim().length === 0) {
				unpricedWithoutRationale.push(model);
			}
		}

		expect(missing).toEqual([]);
		expect(unpricedWithoutRationale).toEqual([]);
	});

	it("prices the shipped Codex/OpenAI and Gemini preset models", () => {
		const provider = createShippedModelPricingProvider();
		for (const model of TARGET_NON_ANTHROPIC_MODELS) {
			const status = getShippedModelPricingStatus(model);
			expect(status?.kind).toBe("priced");
			expect(provider.getPricing(model)).not.toBeNull();
		}
	});

	it("keeps unknown models outside the provider", () => {
		const provider = createShippedModelPricingProvider();
		expect(getShippedModelPricingStatus("unknown-provider-model")).toBeNull();
		expect(provider.getPricing("unknown-provider-model")).toBeNull();
	});

	it("records official source URLs and observation dates for priced rows", () => {
		const sources = Object.values(MODEL_PRICING_SOURCES);
		expect(sources.map((source) => source.url)).toEqual([
			"https://platform.claude.com/docs/en/about-claude/pricing",
			"https://openai.com/api/pricing/",
			"https://ai.google.dev/gemini-api/docs/pricing",
			"https://openrouter.ai/api/v1/models",
		]);

		for (const status of listShippedModelPricingStatuses()) {
			if (status.kind === "priced") {
				expect(status.source.url).toMatch(/^https:\/\//);
				expect(status.source.observedAt).toMatch(/^\d{4}-\d{2}-\d{2}/);
			}
		}
	});

	it("prices the OpenRouter lab preset tiers from the observed OpenRouter catalog", () => {
		const provider = createShippedModelPricingProvider();
		expect(provider.getPricing("openrouter/deepseek/deepseek-v4-flash")).toEqual({
			kind: "flat",
			input: 0.09,
			output: 0.18,
			cacheRead: 0.02,
			cacheWrite: 0,
		});
		expect(provider.getPricing("openrouter/qwen/qwen3.7-plus")).toEqual({
			kind: "flat",
			input: 0.32,
			output: 1.28,
			cacheRead: 0.064,
			cacheWrite: 0.4,
		});
		expect(provider.getPricing("openrouter/z-ai/glm-5.2")).toEqual({
			kind: "flat",
			input: 0.95,
			output: 3,
			cacheRead: 0.18,
			cacheWrite: 0,
		});
	});

	it("represents Gemini Pro's paid Standard prompt-size tiers explicitly", () => {
		const pricing = createShippedModelPricingProvider().getPricing("gemini-2.5-pro");
		expect(pricing?.kind).toBe("input-token-tiered");
		if (pricing?.kind !== "input-token-tiered") throw new Error("expected tiered pricing");
		expect(pricing.tiers).toEqual([
			{
				maxInputTokens: 200_000,
				rates: { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 1.25 },
			},
			{
				maxInputTokens: null,
				rates: { input: 2.5, output: 15, cacheRead: 0.25, cacheWrite: 2.5 },
			},
		]);
	});
});
