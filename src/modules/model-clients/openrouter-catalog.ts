import {
	OPENROUTER_LAB_CANDIDATE_MODEL_IDS,
	OPENROUTER_MODEL_CATALOG,
	OPENROUTER_MODEL_CATALOG_MAX_STALENESS_DAYS,
	OPENROUTER_MODEL_CATALOG_OBSERVED_AT,
	OPENROUTER_MODEL_CATALOG_SOURCE_URL,
	type OpenRouterCandidateSetId,
	type OpenRouterModelCapabilities,
	type OpenRouterObservedModel,
	type OpenRouterSupportedParameter,
} from "./generated/openrouter-catalog-data.js";

export {
	OPENROUTER_DIRECT_PROVIDER_ROUTE_DECISIONS,
	OPENROUTER_LAB_CANDIDATE_MODEL_IDS,
	OPENROUTER_MODEL_CATALOG_MAX_STALENESS_DAYS,
	OPENROUTER_MODEL_CATALOG_OBSERVED_AT,
	OPENROUTER_MODEL_CATALOG_SOURCE_URL,
	OPENROUTER_REQUESTED_CANDIDATE_RESOLUTIONS,
	type OpenRouterCandidateSetId,
	type OpenRouterModality,
	type OpenRouterModelCapabilities,
	type OpenRouterObservedModel,
	type OpenRouterPricing,
	type OpenRouterReasoningEffort,
	type OpenRouterReasoningMetadata,
	type OpenRouterSupportedParameter,
} from "./generated/openrouter-catalog-data.js";

type OpenRouterStoredModel = Omit<
	OpenRouterObservedModel,
	"observedAt" | "sourceUrl"
>;

const OPENROUTER_MODEL_INDEX: ReadonlyMap<string, OpenRouterStoredModel> =
	new Map(OPENROUTER_MODEL_CATALOG.map((model) => [model.id, model]));

function stripOpenRouterProviderPrefix(modelId: string): string {
	return modelId.startsWith("openrouter/")
		? modelId.slice("openrouter/".length)
		: modelId;
}

function providerModelId(modelId: string): string {
	return modelId.startsWith("openrouter/") ? modelId : `openrouter/${modelId}`;
}

function includesParameter(
	parameters: readonly OpenRouterSupportedParameter[],
	parameter: OpenRouterSupportedParameter,
): boolean {
	return parameters.includes(parameter);
}

function toCapabilities(model: OpenRouterStoredModel): OpenRouterModelCapabilities {
	const supportsReasoning =
		model.reasoning.mandatory ||
		includesParameter(model.supportedParameters, "reasoning") ||
		includesParameter(model.supportedParameters, "include_reasoning");
	return {
		...model,
		observedAt: OPENROUTER_MODEL_CATALOG_OBSERVED_AT,
		sourceUrl: OPENROUTER_MODEL_CATALOG_SOURCE_URL,
		providerModelId: providerModelId(model.id),
		supportsTools: includesParameter(model.supportedParameters, "tools"),
		supportsToolChoice: includesParameter(
			model.supportedParameters,
			"tool_choice",
		),
		supportsParallelToolCalls: includesParameter(
			model.supportedParameters,
			"parallel_tool_calls",
		),
		supportsStructuredOutputs: includesParameter(
			model.supportedParameters,
			"structured_outputs",
		),
		supportsReasoning,
		reasoningEffortLevels: model.reasoning.supportedEfforts,
		mandatoryReasoning: model.reasoning.mandatory,
	};
}

export function listOpenRouterCandidateSets(): readonly OpenRouterCandidateSetId[] {
	return ["openrouter-lab"];
}

export function listOpenRouterCatalogModels(): readonly OpenRouterModelCapabilities[] {
	return OPENROUTER_MODEL_CATALOG.map(toCapabilities);
}

export function getOpenRouterModelCapabilities(
	modelId: string,
): OpenRouterModelCapabilities {
	if (modelId.startsWith("ollama/") || modelId.startsWith("lmstudio/")) {
		throw new Error(
			`OpenRouter capability metadata is not available for local OpenAI-compatible route "${modelId}". Use explicit local provider configuration and modelOutputTokenLimits instead.`,
		);
	}
	const canonicalId = stripOpenRouterProviderPrefix(modelId);
	const model = OPENROUTER_MODEL_INDEX.get(canonicalId);
	if (!model) {
		throw new Error(
			`Missing OpenRouter capability metadata for "${modelId}". ` +
				`Update the OpenRouter catalog from ${OPENROUTER_MODEL_CATALOG_SOURCE_URL} before using this model as a shipped candidate.`,
		);
	}
	return toCapabilities(model);
}

export function resolveOpenRouterCandidateSet(
	setId: OpenRouterCandidateSetId | string,
): readonly OpenRouterModelCapabilities[] {
	if (setId !== "openrouter-lab") {
		throw new Error(
			`Unknown OpenRouter candidate set "${setId}". Known sets: ${listOpenRouterCandidateSets().join(", ")}.`,
		);
	}
	return OPENROUTER_LAB_CANDIDATE_MODEL_IDS.map((modelId) =>
		getOpenRouterModelCapabilities(modelId),
	);
}

export function assertOpenRouterCapabilityCatalogFresh(
	now: Date = new Date(),
	maxStalenessDays = OPENROUTER_MODEL_CATALOG_MAX_STALENESS_DAYS,
): void {
	const observedMs = Date.parse(OPENROUTER_MODEL_CATALOG_OBSERVED_AT);
	if (!Number.isFinite(observedMs)) {
		throw new Error(
			`Invalid OpenRouter catalog observedAt timestamp: ${OPENROUTER_MODEL_CATALOG_OBSERVED_AT}.`,
		);
	}
	const maxAgeMs = maxStalenessDays * 24 * 60 * 60 * 1000;
	if (now.getTime() - observedMs > maxAgeMs) {
		throw new Error(
			`OpenRouter capability catalog is stale: observed ${OPENROUTER_MODEL_CATALOG_OBSERVED_AT}, max age ${maxStalenessDays} day(s). Refresh ${OPENROUTER_MODEL_CATALOG_SOURCE_URL} before relying on model capabilities.`,
		);
	}
}

export function resolveFreshOpenRouterCandidateSet(
	setId: OpenRouterCandidateSetId | string,
	now: Date = new Date(),
): readonly OpenRouterModelCapabilities[] {
	assertOpenRouterCapabilityCatalogFresh(now);
	return resolveOpenRouterCandidateSet(setId);
}
