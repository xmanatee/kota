import { describe, expect, it } from "vitest";
import { getPreset } from "#core/model/preset.js";
import {
	assertOpenRouterCapabilityCatalogFresh,
	getOpenRouterModelCapabilities,
	OPENROUTER_DIRECT_PROVIDER_ROUTE_DECISIONS,
	OPENROUTER_LAB_CANDIDATE_MODEL_IDS,
	OPENROUTER_LAB_PRESET_TIER_MODELS,
	OPENROUTER_MODEL_CATALOG_OBSERVED_AT,
	OPENROUTER_MODEL_CATALOG_SOURCE_URL,
	OPENROUTER_REQUESTED_CANDIDATE_RESOLUTIONS,
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
		expect(candidates.map((candidate) => candidate.id)).toContain(
			"inclusionai/ring-2.6-1t",
		);
		expect(candidates.map((candidate) => candidate.id)).not.toContain(
			"inclusionai/ling-2.6-1t",
		);

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

	it("records capability differences that request validation must preserve", () => {
		const glm = getOpenRouterModelCapabilities("z-ai/glm-5.2");
		expect(glm).toMatchObject({
			providerModelId: "openrouter/z-ai/glm-5.2",
			contextLength: 1_048_576,
			maxOutputTokens: 32_768,
			supportsTools: true,
			supportsStructuredOutputs: true,
			supportsParallelToolCalls: false,
			supportsReasoning: true,
			mandatoryReasoning: false,
			reasoningEffortLevels: ["xhigh", "high"],
		});

		const kimi = getOpenRouterModelCapabilities("moonshotai/kimi-k2.7-code");
		expect(kimi.supportsParallelToolCalls).toBe(true);
		expect(kimi.mandatoryReasoning).toBe(true);
		expect(kimi.inputModalities).toEqual(["text", "image"]);

		const kat = getOpenRouterModelCapabilities("kwaipilot/kat-coder-pro-v2");
		expect(kat.supportsTools).toBe(true);
		expect(kat.supportsReasoning).toBe(false);
		expect(kat.supportsStructuredOutputs).toBe(true);

		const laguna = getOpenRouterModelCapabilities("poolside/laguna-m.1");
		expect(laguna.supportsTools).toBe(true);
		expect(laguna.supportsReasoning).toBe(true);
		expect(laguna.supportsStructuredOutputs).toBe(false);

		const hy3 = getOpenRouterModelCapabilities("tencent/hy3-preview");
		expect(hy3.maxOutputTokens).toBeNull();
		expect(hy3.reasoningEffortLevels).toEqual(["high", "low", "none"]);

		const ring = getOpenRouterModelCapabilities("inclusionai/ring-2.6-1t");
		expect(ring).toMatchObject({
			name: "inclusionAI: Ring-2.6-1T",
			providerModelId: "openrouter/inclusionai/ring-2.6-1t",
			supportsTools: true,
			supportsStructuredOutputs: true,
			supportsReasoning: true,
			mandatoryReasoning: false,
		});
	});

	it("aligns the non-default OpenRouter lab preset with the candidate catalog", () => {
		const preset = getPreset("openrouter-lab");
		expect(preset.tiers).toEqual({
			fast: "openrouter/deepseek/deepseek-v4-flash",
			balanced: "openrouter/qwen/qwen3.7-plus",
			capable: "openrouter/z-ai/glm-5.2",
		});
		expect(getOpenRouterModelCapabilities(preset.tiers.fast).id).toBe(
			OPENROUTER_LAB_PRESET_TIER_MODELS.fast,
		);
		expect(getOpenRouterModelCapabilities(preset.tiers.balanced).id).toBe(
			OPENROUTER_LAB_PRESET_TIER_MODELS.balanced,
		);
		expect(getOpenRouterModelCapabilities(preset.tiers.capable).id).toBe(
			OPENROUTER_LAB_PRESET_TIER_MODELS.capable,
		);
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

	it("records requested route decisions without inventing direct providers", () => {
		expect(OPENROUTER_REQUESTED_CANDIDATE_RESOLUTIONS).toEqual([]);
		expect(OPENROUTER_DIRECT_PROVIDER_ROUTE_DECISIONS.map((decision) => decision.provider)).toEqual([
			"z-ai",
			"moonshotai",
		]);
	});
});
