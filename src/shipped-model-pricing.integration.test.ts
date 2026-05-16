import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CostTracker } from "#core/loop/cost.js";
import {
	initProviderRegistry,
	MODEL_PRICING_PROVIDER_TOKEN,
	resetProviderRegistry,
} from "#core/modules/provider-registry.js";
import { createShippedModelPricingProvider } from "#modules/model-clients/pricing.js";

const TARGET_PRICED_MODELS = [
	"gpt-5.5",
	"gpt-5.4",
	"gpt-5.4-mini",
	"gemini-2.5-pro",
	"gemini-2.5-flash",
	"gemini-2.5-flash-lite",
] as const;

describe("shipped model pricing and CostTracker", () => {
	beforeEach(() => {
		const registry = initProviderRegistry();
		registry.register(
			MODEL_PRICING_PROVIDER_TOKEN,
			"shipped",
			createShippedModelPricingProvider(),
		);
	});

	afterEach(() => {
		resetProviderRegistry();
	});

	it("produces nonzero representative costs for shipped Codex/OpenAI and Gemini models", () => {
		for (const model of TARGET_PRICED_MODELS) {
			const tracker = new CostTracker();
			tracker.addUsage(model, {
				input_tokens: 1_000,
				output_tokens: 1_000,
			});
			expect(tracker.getTotalCost()).toBeGreaterThan(0);
		}
	});

	it("keeps true unknown models at zero dollars", () => {
		const tracker = new CostTracker();
		tracker.addUsage("unknown-provider-model", {
			input_tokens: 1_000_000,
			output_tokens: 1_000_000,
		});
		expect(tracker.getTotalCost()).toBe(0);
		expect(tracker.getSummary()).toContain("$0.0000");
	});
});
