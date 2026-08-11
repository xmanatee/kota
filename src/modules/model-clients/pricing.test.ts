import { describe, expect, it } from "vitest";
import { listShippedPresetModelIds } from "#core/model/output-token-limits.js";
import {
	createShippedModelPricingProvider,
	getShippedModelPricingStatus,
	listShippedModelPricingStatuses,
} from "./pricing.js";

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

	it("returns pricing only for rows classified as priced", () => {
		const provider = createShippedModelPricingProvider();
		for (const status of listShippedModelPricingStatuses()) {
			expect(provider.getPricing(status.model)).toEqual(
				status.kind === "priced" ? status.pricing : null,
			);
		}
	});

	it("keeps unknown models outside the provider", () => {
		const provider = createShippedModelPricingProvider();
		expect(getShippedModelPricingStatus("unknown-provider-model")).toBeNull();
		expect(provider.getPricing("unknown-provider-model")).toBeNull();
	});

	it("validates pricing provenance and positive usage rates", () => {
		for (const status of listShippedModelPricingStatuses()) {
			if (status.kind !== "priced") continue;
			expect(status.source.url).toMatch(/^https:\/\//);
			expect(status.source.observedAt).toMatch(/^\d{4}-\d{2}-\d{2}/);

			const rates =
				status.pricing.kind === "flat"
					? [status.pricing]
					: status.pricing.tiers.map((tier) => tier.rates);
			for (const rate of rates) {
				expect(rate.input).toBeGreaterThan(0);
				expect(rate.output).toBeGreaterThan(0);
				expect(rate.cacheRead).toBeGreaterThanOrEqual(0);
				expect(rate.cacheWrite).toBeGreaterThanOrEqual(0);
			}
		}
	});
});
