/**
 * Minimal OpenAI-compatible API type subset used by the translation layer.
 */

import type { AgentEffort } from "#core/model/model-client.js";

export type OAITextContentPart = {
	type: "text";
	text: string;
};

export type OAIImageContentPart = {
	type: "image_url";
	image_url: { url: string };
};

export type OAIUserContentPart = OAITextContentPart | OAIImageContentPart;

export type OAIMessage =
	| { role: "system"; content: string }
	| { role: "user"; content: string | OAIUserContentPart[] }
	| { role: "assistant"; content: string | null; tool_calls?: OAIToolCall[] }
	| { role: "tool"; tool_call_id: string; content: string };

export type OAIToolCall = {
	id: string;
	type: "function";
	function: { name: string; arguments: string };
};

export type OAITool = {
	type: "function";
	function: {
		name: string;
		description: string;
		parameters: Record<string, unknown>;
	};
};

export type OAIReasoningEffort = AgentEffort | "none";

export type OAIUsage = {
	prompt_tokens?: number;
	completion_tokens?: number;
	total_tokens?: number;
	prompt_tokens_details?: {
		cached_tokens?: number;
		cache_creation_tokens?: number;
	};
	completion_tokens_details?: {
		reasoning_tokens?: number;
	};
};

export type OAIModelCapabilities = {
	modelId: string;
	maxOutputTokens?: number | null;
	inputModalities?: readonly ("text" | "image" | "audio" | "file" | "video")[];
	supportsTools?: boolean;
	supportsToolChoice?: boolean;
	supportsParallelToolCalls?: boolean;
	supportsResponseFormat?: boolean;
	supportsStructuredOutputs?: boolean;
	supportsIncludeReasoning?: boolean;
	supportsReasoning?: boolean;
	mandatoryReasoning?: boolean;
	defaultReasoningEnabled?: boolean;
	reasoningEffortLevels?: readonly OAIReasoningEffort[];
	defaultReasoningEffort?: OAIReasoningEffort;
};

export type OAIResponseFormat =
	| { type: "json_object" }
	| {
			type: "json_schema";
			json_schema: {
				name: string;
				strict?: boolean;
				schema: object;
			};
	  };

export type OAIToolChoice =
	| "auto"
	| "none"
	| "required"
	| { type: "function"; function: { name: string } };

export type OAIProviderRouting = {
	order?: readonly string[];
	allow_fallbacks?: boolean;
	only?: readonly string[];
	ignore?: readonly string[];
	sort?:
		| "price"
		| "throughput"
		| "latency"
		| { by: "price" | "throughput" | "latency"; partition?: "model" | "none" };
};

export type OAIRequestOptions = {
	toolChoice?: OAIToolChoice;
	parallelToolCalls?: boolean;
	responseFormat?: OAIResponseFormat;
	structuredOutputs?: boolean;
	includeReasoning?: boolean;
	provider?: OAIProviderRouting;
};

export type OAIStreamChunk = {
	id: string;
	choices: Array<{
		index: number;
		delta: {
			role?: string;
			content?: string | null;
			reasoning?: string | null;
			reasoning_content?: string | null;
			tool_calls?: Array<{
				index: number;
				id?: string;
				type?: string;
				function?: { name?: string; arguments?: string };
			}>;
		};
		finish_reason: string | null;
	}>;
	model: string;
	usage?: OAIUsage;
};

export type OAIReasoningDeltaEvent = {
	type: "response.reasoning.delta";
	delta: string;
	model?: string;
};

export type OAIResponse = {
	id: string;
	choices: Array<{
		message: {
			role: string;
			content: string | null;
			reasoning?: string | null;
			reasoning_content?: string | null;
			tool_calls?: OAIToolCall[];
		};
		finish_reason: string;
	}>;
	model: string;
	usage?: OAIUsage;
};
