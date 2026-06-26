import type { OAIModelCapabilities } from "./openai/types.js";
import {
	getOpenRouterModelCapabilities,
	type OpenRouterModelCapabilities,
	type OpenRouterSupportedParameter,
} from "./openrouter-catalog.js";

function hasOpenRouterParameter(
	capabilities: OpenRouterModelCapabilities,
	parameter: OpenRouterSupportedParameter,
): boolean {
	return capabilities.supportedParameters.includes(parameter);
}

export function openRouterCapabilitiesToOpenAIModelCapabilities(
	capabilities: OpenRouterModelCapabilities,
): OAIModelCapabilities {
	return {
		modelId: capabilities.id,
		maxOutputTokens: capabilities.maxOutputTokens,
		inputModalities: capabilities.inputModalities,
		supportsTools: capabilities.supportsTools,
		supportsToolChoice: capabilities.supportsToolChoice,
		supportsParallelToolCalls: capabilities.supportsParallelToolCalls,
		supportsResponseFormat: hasOpenRouterParameter(
			capabilities,
			"response_format",
		),
		supportsStructuredOutputs: capabilities.supportsStructuredOutputs,
		supportsIncludeReasoning: hasOpenRouterParameter(
			capabilities,
			"include_reasoning",
		),
		supportsReasoning: capabilities.supportsReasoning,
		mandatoryReasoning: capabilities.mandatoryReasoning,
		defaultReasoningEnabled: capabilities.reasoning.defaultEnabled === true,
		reasoningEffortLevels: capabilities.reasoningEffortLevels,
		...(capabilities.reasoning.defaultEffort !== undefined
			? { defaultReasoningEffort: capabilities.reasoning.defaultEffort }
			: {}),
	};
}

export function resolveOpenAIModelCapabilities(
	providerName: string,
	model: string,
): OAIModelCapabilities | undefined {
	if (providerName !== "openrouter") return undefined;
	try {
		return openRouterCapabilitiesToOpenAIModelCapabilities(
			getOpenRouterModelCapabilities(model),
		);
	} catch (error) {
		if (
			error instanceof Error &&
			error.message.startsWith("Missing OpenRouter capability metadata")
		) {
			return undefined;
		}
		throw error;
	}
}
