/**
 * Bidirectional format translation between KOTA's neutral message protocol
 * and OpenAI chat-completion shapes.
 */

import type {
	KotaContentBlock,
	KotaImageBlock,
	KotaMessage,
	KotaModelResponse,
	KotaStopReason,
	KotaTextBlock,
	KotaTool,
} from "#core/agent-harness/message-protocol.js";
import { extractToolResultContent } from "./tool-result-projection.js";
import type {
	OAIMessage,
	OAITool,
	OAIToolCall,
	OAIUsage,
	OAIUserContentPart,
} from "./types.js";

export { extractToolResultContent } from "./tool-result-projection.js";

/** Extract plain text from the system param (string or KotaTextBlock[]). */
export function systemToText(
	system: KotaTextBlock[] | string | undefined,
): string | undefined {
	if (!system) return undefined;
	if (typeof system === "string") return system;
	return system.map((b) => b.text).join("\n\n");
}

/**
 * Convert a single neutral `KotaMessage` to the OpenAI chat-completion
 * message array for that transcript entry. A `KotaMessage` with blended
 * text and `tool_result` blocks expands into multiple OpenAI entries, so
 * the helper returns an array; callers flatten with `toOpenAIMessages`.
 */
export function kotaMessageToOpenAiMessage(msg: KotaMessage): OAIMessage[] {
	if (msg.role === "user") {
		if (typeof msg.content === "string") {
			return [{ role: "user", content: msg.content }];
		}
		const entries: OAIMessage[] = [];
		const parts: OAIUserContentPart[] = [];
		for (const block of msg.content) {
			if (block.type === "text") {
				parts.push({ type: "text", text: block.text });
			} else if (block.type === "image") {
				parts.push(imageBlockToOpenAI(block));
			} else if (block.type === "tool_result") {
				if (parts.length > 0) {
					entries.push({ role: "user", content: collapseUserContent(parts) });
					parts.length = 0;
				}
				entries.push({
					role: "tool",
					tool_call_id: block.tool_use_id,
					content: extractToolResultContent(block),
				});
			}
		}
		if (parts.length > 0) {
			entries.push({ role: "user", content: collapseUserContent(parts) });
		}
		return entries;
	}

	if (typeof msg.content === "string") {
		return [{ role: "assistant", content: msg.content }];
	}
	const textParts: string[] = [];
	const toolCalls: OAIToolCall[] = [];
	for (const block of msg.content) {
		if (block.type === "text") {
			textParts.push(block.text);
		} else if (block.type === "tool_use") {
			toolCalls.push({
				id: block.id,
				type: "function",
				function: {
					name: block.name,
					arguments: JSON.stringify(block.input),
				},
			});
		}
		// thinking and image blocks have no OpenAI assistant-message analog
	}
	const entry: OAIMessage = {
		role: "assistant",
		content: textParts.length > 0 ? textParts.join("\n") : null,
	};
	if (toolCalls.length > 0) {
		(entry as { tool_calls?: OAIToolCall[] }).tool_calls = toolCalls;
	}
	return [entry];
}

function imageBlockToOpenAI(block: KotaImageBlock): OAIUserContentPart {
	return {
		type: "image_url",
		image_url: {
			url: `data:${block.source.media_type};base64,${block.source.data}`,
		},
	};
}

function collapseUserContent(
	parts: readonly OAIUserContentPart[],
): string | OAIUserContentPart[] {
	const hasImage = parts.some((part) => part.type === "image_url");
	if (!hasImage) {
		return parts
			.map((part) => (part.type === "text" ? part.text : ""))
			.join("\n");
	}
	return [...parts];
}

/** Convert neutral KOTA messages + system to OpenAI message array. */
export function toOpenAIMessages(
	system: KotaTextBlock[] | string | undefined,
	messages: KotaMessage[],
): OAIMessage[] {
	const result: OAIMessage[] = [];
	const sysText = systemToText(system);
	if (sysText) result.push({ role: "system", content: sysText });

	for (const msg of messages) {
		for (const entry of kotaMessageToOpenAiMessage(msg)) {
			result.push(entry);
		}
	}
	return result;
}

/** Convert neutral KotaTool definitions to OpenAI tool format. */
export function toOpenAITools(tools: KotaTool[]): OAITool[] {
	return tools.map((t) => ({
		type: "function" as const,
		function: {
			name: t.name,
			description: t.description,
			parameters: t.input_schema as Record<string, unknown>,
		},
	}));
}

/** Map OpenAI finish_reason to the neutral `KotaStopReason`. */
export function mapFinishReason(reason: string | null): KotaStopReason {
	switch (reason) {
		case "stop":
			return "end_turn";
		case "tool_calls":
			return "tool_use";
		case "length":
			return "max_tokens";
		default:
			return "end_turn";
	}
}

/** Build a neutral `KotaModelResponse` from accumulated OpenAI response data. */
export function buildKotaModelResponse(opts: {
	text: string;
	toolCalls: Array<{ id: string; name: string; input: unknown }>;
	stopReason: KotaStopReason;
	model: string;
	usage: {
		input: number;
		output: number;
		cacheReadInput?: number | null;
		cacheCreationInput?: number | null;
	};
}): KotaModelResponse {
	const content: KotaContentBlock[] = [];
	if (opts.text) {
		content.push({ type: "text", text: opts.text });
	}
	for (const tc of opts.toolCalls) {
		content.push({
			type: "tool_use",
			id: tc.id,
			name: tc.name,
			input: tc.input,
		});
	}
	if (content.length === 0) {
		content.push({ type: "text", text: "" });
	}
	return {
		id: `msg_oai_${Date.now()}`,
		role: "assistant",
		model: opts.model,
		content,
		stop_reason: opts.stopReason,
		stop_sequence: null,
		usage: {
			input_tokens: opts.usage.input,
			output_tokens: opts.usage.output,
			cache_creation_input_tokens: opts.usage.cacheCreationInput ?? null,
			cache_read_input_tokens: opts.usage.cacheReadInput ?? null,
		},
	};
}

export function openAIUsageToKotaUsage(usage: OAIUsage | undefined): {
	input: number;
	output: number;
	cacheReadInput?: number | null;
	cacheCreationInput?: number | null;
} {
	return {
		input: usage?.prompt_tokens ?? 0,
		output: usage?.completion_tokens ?? 0,
		cacheReadInput: usage?.prompt_tokens_details?.cached_tokens ?? null,
		cacheCreationInput:
			usage?.prompt_tokens_details?.cache_creation_tokens ?? null,
	};
}

/** Parse JSON with fallback to raw string wrapper. */
export function safeJsonParse(s: string): unknown {
	if (!s) return {};
	try {
		return JSON.parse(s);
	} catch {
		return { _raw: s };
	}
}
