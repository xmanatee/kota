import { describe, expect, it } from "vitest";
import { getPreset } from "#core/model/preset.js";
import {
	assertOpenRouterCapabilityCatalogFresh,
	getOpenRouterModelCapabilities,
	OPENROUTER_LAB_CANDIDATE_MODEL_IDS,
	OPENROUTER_MODEL_CATALOG_OBSERVED_AT,
	OPENROUTER_MODEL_CATALOG_SOURCE_URL,
	resolveFreshOpenRouterCandidateSet,
	resolveOpenRouterCandidateSet,
} from "./openrouter-catalog.js";

describe("OpenRouter capability catalog", () => {
	it("resolves the named lab candidate set with explicit capability metadata", () => {
		const candidates = resolveFreshOpenRouterCandidateSet(
			"openrouter-lab",
			new Date("2026-06-26T12:00:00.000Z"),
		);

		expect(candidates.map((candidate) => candidate.id)).toEqual([
			...OPENROUTER_LAB_CANDIDATE_MODEL_IDS,
		]);

		for (const candidate of candidates) {
			expect(candidate.id).not.toBe("openrouter/auto");
			expect(candidate.providerModelId).toBe(`openrouter/${candidate.id}`);
			expect(candidate.observedAt).toBe(OPENROUTER_MODEL_CATALOG_OBSERVED_AT);
			expect(candidate.sourceUrl).toBe(OPENROUTER_MODEL_CATALOG_SOURCE_URL);
			expect(candidate.contextLength).toBeGreaterThan(0);
			expect(candidate.maxOutputTokens === null || candidate.maxOutputTokens > 0).toBe(true);
			expect(candidate.pricing.prompt).toMatch(/^\d/);
			expect(candidate.pricing.completion).toMatch(/^\d/);
			expect(typeof candidate.supportsTools).toBe("boolean");
			expect(typeof candidate.supportsToolChoice).toBe("boolean");
			expect(typeof candidate.supportsStructuredOutputs).toBe("boolean");
			expect(typeof candidate.supportsReasoning).toBe("boolean");
			expect(typeof candidate.mandatoryReasoning).toBe("boolean");
			expect(Array.isArray(candidate.reasoningEffortLevels)).toBe(true);
			expect(candidate.inputModalities.length).toBeGreaterThan(0);
			expect(candidate.outputModalities.length).toBeGreaterThan(0);
		}
	});

	it("resolves every OpenRouter lab preset tier through the capability catalog", () => {
		const preset = getPreset("openrouter-lab");
		for (const model of Object.values(preset.tiers)) {
			expect(getOpenRouterModelCapabilities(model).providerModelId).toBe(model);
		}
	});

	it("keeps local OpenAI-compatible routes outside OpenRouter metadata", () => {
		expect(() => getOpenRouterModelCapabilities("ollama/glm-5.2")).toThrow(
			/local OpenAI-compatible route/,
		);
		expect(() => getOpenRouterModelCapabilities("lmstudio/kimi-k2.7-code")).toThrow(
			/local OpenAI-compatible route/,
		);
		expect(() => getOpenRouterModelCapabilities("vllm/custom-local-model")).toThrow(
			/Missing OpenRouter capability metadata/,
		);
	});

	it("fails loudly for unknown candidate sets, missing models, and stale snapshots", () => {
		expect(() => resolveOpenRouterCandidateSet("missing-set")).toThrow(
			/Unknown OpenRouter candidate set/,
		);
		expect(() => getOpenRouterModelCapabilities("openrouter/auto")).toThrow(
			/Missing OpenRouter capability metadata/,
		);
		expect(() =>
			assertOpenRouterCapabilityCatalogFresh(
				new Date("2027-01-01T00:00:00.000Z"),
			),
		).toThrow(/OpenRouter capability catalog is stale/);
	});
});
