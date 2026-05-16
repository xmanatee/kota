/**
 * Bidirectional format translation between KOTA's neutral message protocol
 * and OpenAI chat-completion shapes.
 */

import type {
	KotaContentBlock,
	KotaMessage,
	KotaModelResponse,
	KotaStopReason,
	KotaTextBlock,
	KotaTool,
	KotaToolResultBlock,
} from "#core/agent-harness/message-protocol.js";
import type { OAIMessage, OAITool, OAIToolCall } from "./types.js";

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
		const textParts: string[] = [];
		for (const block of msg.content) {
			if (block.type === "text") {
				textParts.push(block.text);
			} else if (block.type === "tool_result") {
				if (textParts.length > 0) {
					entries.push({ role: "user", content: textParts.join("\n") });
					textParts.length = 0;
				}
				entries.push({
					role: "tool",
					tool_call_id: block.tool_use_id,
					content: extractToolResultContent(block),
				});
			}
		}
		if (textParts.length > 0) {
			entries.push({ role: "user", content: textParts.join("\n") });
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

/** Extract text content from a tool result block. */
export function extractToolResultContent(block: KotaToolResultBlock): string {
	const unsupported: string[] = [];
	if (block.structuredContent !== undefined) unsupported.push("structuredContent");
	if (block._meta !== undefined) unsupported.push("_meta");
	if (Array.isArray(block.content)) {
		block.content.forEach((entry, index) => {
			if (entry.type === "mcp_content") {
				unsupported.push(`content[${index}].mcp_content:${entry.content.type}`);
				return;
			}
			if (entry.type === "image") {
				unsupported.push(`content[${index}].image:${entry.source.media_type}`);
			}
			if (entry.annotations !== undefined) {
				unsupported.push(`content[${index}].annotations`);
			}
			if (entry._meta !== undefined) {
				unsupported.push(`content[${index}]._meta`);
			}
		});
	}
	if (unsupported.length > 0) {
		throw new Error(
			`OpenAI model client cannot translate enriched tool_result fields: ${unsupported.join(", ")}`,
		);
	}
	const prefix = block.is_error ? "[ERROR] " : "";
	if (typeof block.content === "string") return prefix + block.content;
	if (!block.content) return `${prefix}`;
	const texts = block.content.map((entry) => {
		if (entry.type !== "text") {
			throw new Error(
				`OpenAI model client cannot translate non-text tool_result content: ${entry.type}`,
			);
		}
		return entry.text;
	});
	return prefix + texts.join("\n");
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
	usage: { input: number; output: number };
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
			cache_creation_input_tokens: null,
			cache_read_input_tokens: null,
		},
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
