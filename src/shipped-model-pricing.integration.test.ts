import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CostTracker } from "#core/loop/cost.js";
import {
	initProviderRegistry,
	MODEL_PRICING_PROVIDER_TOKEN,
	resetProviderRegistry,
} from "#core/modules/provider-registry.js";
import {
	createShippedModelPricingProvider,
	listShippedModelPricingStatuses,
} from "#modules/model-clients/pricing.js";

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

	it("produces nonzero costs for every shipped model classified as priced", () => {
		const pricedModels = listShippedModelPricingStatuses()
			.filter((status) => status.kind === "priced")
			.map((status) => status.model);
		for (const model of pricedModels) {
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
