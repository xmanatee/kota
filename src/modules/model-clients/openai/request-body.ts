import type { KotaMessage } from "#core/agent-harness/message-protocol.js";
import type {
	AgentEffort,
	MessageCreateParams,
	MessageStreamParams,
} from "#core/model/model-client.js";
import { buildMissingReasoningError, type EffortTranslator } from "../reasoning.js";
import { toOpenAIMessages, toOpenAITools } from "./translations.js";
import type {
	OAIModelCapabilities,
	OAIReasoningEffort,
	OAIRequestOptions,
} from "./types.js";

export type OpenAIRequestBody = {
	model: string;
	max_tokens?: number;
	max_completion_tokens?: number;
	messages: ReturnType<typeof toOpenAIMessages>;
	stream: boolean;
	tools?: ReturnType<typeof toOpenAITools>;
	stream_options?: { include_usage: true };
	tool_choice?: OAIRequestOptions["toolChoice"];
	parallel_tool_calls?: boolean;
	response_format?: OAIRequestOptions["responseFormat"];
	structured_outputs?: boolean;
	provider?: OAIRequestOptions["provider"];
	include_reasoning?: true;
	reasoning_effort?: OAIReasoningEffort;
	reasoning?: { effort: OAIReasoningEffort };
	thinking?: object;
};

export type OpenAIRequestBodyOptions = {
	presetName: string;
	effortTranslator?: EffortTranslator;
	modelCapabilities?: OAIModelCapabilities;
	requestOptions: OAIRequestOptions;
};

export function buildOpenAIRequestBody(
	params: MessageStreamParams | MessageCreateParams,
	stream: boolean,
	options: OpenAIRequestBodyOptions,
): OpenAIRequestBody {
	validateOutputTokenLimit(params.model, params.max_tokens, options);
	validateMultimodalInput(params.model, params.messages, options);
	validateOpenAIGpt56ChatCompletionsTools(params, options);
	const body: OpenAIRequestBody = {
		model: params.model,
		messages: toOpenAIMessages(params.system, params.messages),
		stream,
	};
	if (options.presetName === "openai") {
		body.max_completion_tokens = params.max_tokens;
	} else {
		body.max_tokens = params.max_tokens;
	}
	applyToolOptions(params, body, options);
	applyRequestOptions(params.model, body, options);
	if (stream) {
		body.stream_options = { include_usage: true };
	}
	applyReasoningOptions(params, body, options);
	return body;
}

function validateOpenAIGpt56ChatCompletionsTools(
	params: MessageStreamParams | MessageCreateParams,
	options: OpenAIRequestBodyOptions,
): void {
	if (options.presetName !== "openai") return;
	if (!/^gpt-5\.6(?:-(?:sol|terra|luna))?$/.test(params.model)) return;
	const tools = "tools" in params ? params.tools : undefined;
	if (tools === undefined || tools.length === 0) return;
	throw new Error(
		`GPT-5.6 function tools are incompatible with OpenAI Chat Completions at its default reasoning effort and KOTA's supported effort levels. ` +
			"Use a Responses API-capable harness or the Codex harness.",
	);
}

function validateOutputTokenLimit(
	model: string,
	maxTokens: number,
	options: OpenAIRequestBodyOptions,
): void {
	const limit = options.modelCapabilities?.maxOutputTokens;
	if (limit === undefined || limit === null || maxTokens <= limit) return;
	throw new Error(
		`Model "${model}" supports at most ${limit} output tokens; requested max_tokens=${maxTokens}.`,
	);
}

function validateMultimodalInput(
	model: string,
	messages: KotaMessage[],
	options: OpenAIRequestBodyOptions,
): void {
	if (!messages.some((message) => messageContainsImage(message))) return;
	const modalities = options.modelCapabilities?.inputModalities;
	if (!modalities || modalities.includes("image")) return;
	throw new Error(`Model "${model}" does not support image input.`);
}

function applyToolOptions(
	params: MessageStreamParams | MessageCreateParams,
	body: OpenAIRequestBody,
	options: OpenAIRequestBodyOptions,
): void {
	const tools = "tools" in params ? params.tools : undefined;
	const hasTools = tools !== undefined && tools.length > 0;
	if (!hasTools) {
		if (options.requestOptions.toolChoice !== undefined) {
			throw new Error("tool_choice requires at least one tool definition.");
		}
		return;
	}
	if (options.modelCapabilities?.supportsTools === false) {
		throw unsupportedFeatureError(params.model, "tools", options);
	}
	body.tools = toOpenAITools(tools);

	if (options.requestOptions.toolChoice !== undefined) {
		if (options.modelCapabilities?.supportsToolChoice === false) {
			throw unsupportedFeatureError(params.model, "tool_choice", options);
		}
		body.tool_choice = options.requestOptions.toolChoice;
	} else if (options.modelCapabilities?.supportsToolChoice) {
		body.tool_choice = "auto";
	}

	if (options.requestOptions.parallelToolCalls !== undefined) {
		if (
			options.requestOptions.parallelToolCalls &&
			options.modelCapabilities?.supportsParallelToolCalls === false
		) {
			throw unsupportedFeatureError(params.model, "parallel_tool_calls", options);
		}
		body.parallel_tool_calls = options.requestOptions.parallelToolCalls;
	} else if (options.modelCapabilities?.supportsParallelToolCalls) {
		body.parallel_tool_calls = true;
	}
}

function applyRequestOptions(
	model: string,
	body: OpenAIRequestBody,
	options: OpenAIRequestBodyOptions,
): void {
	if (options.requestOptions.responseFormat !== undefined) {
		if (options.modelCapabilities?.supportsResponseFormat === false) {
			throw unsupportedFeatureError(model, "response_format", options);
		}
		body.response_format = options.requestOptions.responseFormat;
	}
	if (options.requestOptions.structuredOutputs !== undefined) {
		if (
			options.requestOptions.structuredOutputs &&
			options.modelCapabilities?.supportsStructuredOutputs === false
		) {
			throw unsupportedFeatureError(model, "structured_outputs", options);
		}
		body.structured_outputs = options.requestOptions.structuredOutputs;
	}
	if (options.requestOptions.provider !== undefined) {
		body.provider = options.requestOptions.provider;
	}
}

function applyReasoningOptions(
	params: MessageStreamParams | MessageCreateParams,
	body: OpenAIRequestBody,
	options: OpenAIRequestBodyOptions,
): void {
	const effort = "effort" in params ? params.effort : undefined;
	const capabilities = options.modelCapabilities;
	const modelRequestsReasoning =
		effort !== undefined ||
		capabilities?.mandatoryReasoning === true ||
		capabilities?.defaultReasoningEnabled === true;

	if (
		options.requestOptions.includeReasoning === true &&
		capabilities?.supportsIncludeReasoning === false
	) {
		throw unsupportedFeatureError(params.model, "include_reasoning", options);
	}
	const includeReasoning =
		options.requestOptions.includeReasoning ?? modelRequestsReasoning;
	if (
		includeReasoning &&
		(capabilities?.supportsIncludeReasoning === true ||
			(capabilities === undefined &&
				options.requestOptions.includeReasoning === true))
	) {
		body.include_reasoning = true;
	}

	if (capabilities) {
		if (modelRequestsReasoning && capabilities.supportsReasoning === false) {
			throw unsupportedFeatureError(params.model, "reasoning", options);
		}
		if (effort !== undefined) {
			const capabilityEffort = resolveCapabilityEffort(
				params.model,
				effort,
				capabilities,
			);
			body.reasoning = { effort: capabilityEffort };
		} else if (capabilities.defaultReasoningEffort !== undefined) {
			body.reasoning = { effort: capabilities.defaultReasoningEffort };
		}
		return;
	}

	if (effort !== undefined) {
		if (!options.effortTranslator) {
			throw buildMissingReasoningError(options.presetName, effort);
		}
		Object.assign(body, options.effortTranslator.apply(effort));
	}
}

function unsupportedFeatureError(
	model: string,
	feature: string,
	options: OpenAIRequestBodyOptions,
): Error {
	const capabilityId = options.modelCapabilities?.modelId ?? model;
	return new Error(
		`Model "${capabilityId}" does not support ${feature}; refusing to send an incompatible OpenAI-compatible request.`,
	);
}

function messageContainsImage(message: KotaMessage): boolean {
	return Array.isArray(message.content)
		? message.content.some((block) => block.type === "image")
		: false;
}

function resolveCapabilityEffort(
	model: string,
	effort: AgentEffort,
	capabilities: OAIModelCapabilities,
): OAIReasoningEffort {
	const supported = capabilities.reasoningEffortLevels ?? [];
	if (supported.length === 0) {
		throw new Error(
			`Model "${capabilities.modelId || model}" does not declare supported reasoning effort values; ` +
				`effort "${effort}" cannot be honored. Supported reasoning efforts: none declared.`,
		);
	}
	if (supported.includes(effort)) return effort;
	throw new Error(
		`Model "${capabilities.modelId || model}" does not support reasoning effort "${effort}". ` +
			`Supported reasoning efforts: ${supported.join(", ")}.`,
	);
}
