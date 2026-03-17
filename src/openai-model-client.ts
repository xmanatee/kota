/**
 * OpenAI-compatible ModelClient implementation.
 *
 * Translates between Anthropic message format (used internally by KOTA)
 * and the OpenAI chat completions API format. Works with any OpenAI-compatible
 * provider: OpenAI, Ollama, Groq, Together, vLLM, LM Studio, etc.
 *
 * This enables running KOTA without an Anthropic API key — point it at
 * a local Ollama instance or any compatible endpoint.
 */

import type Anthropic from "@anthropic-ai/sdk";
import type {
	MessageCreateParams,
	MessageStream,
	MessageStreamParams,
	ModelClient,
} from "./model-client.js";

// --- OpenAI types (minimal subset) ---

type OAIMessage =
	| { role: "system"; content: string }
	| { role: "user"; content: string }
	| { role: "assistant"; content: string | null; tool_calls?: OAIToolCall[] }
	| { role: "tool"; tool_call_id: string; content: string };

type OAIToolCall = {
	id: string;
	type: "function";
	function: { name: string; arguments: string };
};

type OAITool = {
	type: "function";
	function: {
		name: string;
		description: string;
		parameters: Record<string, unknown>;
	};
};

type OAIStreamChunk = {
	id: string;
	choices: Array<{
		index: number;
		delta: {
			role?: string;
			content?: string | null;
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
	usage?: { prompt_tokens: number; completion_tokens: number };
};

type OAIResponse = {
	id: string;
	choices: Array<{
		message: {
			role: string;
			content: string | null;
			tool_calls?: OAIToolCall[];
		};
		finish_reason: string;
	}>;
	model: string;
	usage?: { prompt_tokens: number; completion_tokens: number };
};

// --- Translation functions ---

/** Extract plain text from the system param (string or TextBlockParam[]). */
export function systemToText(
	system: Anthropic.Messages.TextBlockParam[] | string | undefined,
): string | undefined {
	if (!system) return undefined;
	if (typeof system === "string") return system;
	return system.map((b) => b.text).join("\n\n");
}

/** Convert Anthropic messages + system to OpenAI message array. */
export function toOpenAIMessages(
	system: Anthropic.Messages.TextBlockParam[] | string | undefined,
	messages: Anthropic.MessageParam[],
): OAIMessage[] {
	const result: OAIMessage[] = [];
	const sysText = systemToText(system);
	if (sysText) result.push({ role: "system", content: sysText });

	for (const msg of messages) {
		if (msg.role === "user") {
			if (typeof msg.content === "string") {
				result.push({ role: "user", content: msg.content });
				continue;
			}
			const textParts: string[] = [];
			for (const block of msg.content) {
				if (block.type === "text") {
					textParts.push(block.text);
				} else if (block.type === "tool_result") {
					if (textParts.length > 0) {
						result.push({ role: "user", content: textParts.join("\n") });
						textParts.length = 0;
					}
					result.push({
						role: "tool",
						tool_call_id: block.tool_use_id,
						content: extractToolResultContent(block),
					});
				}
			}
			if (textParts.length > 0) {
				result.push({ role: "user", content: textParts.join("\n") });
			}
		} else if (msg.role === "assistant") {
			if (typeof msg.content === "string") {
				result.push({ role: "assistant", content: msg.content });
				continue;
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
				// thinking blocks are skipped (OpenAI has no equivalent)
			}
			const entry: OAIMessage = {
				role: "assistant",
				content: textParts.length > 0 ? textParts.join("\n") : null,
			};
			if (toolCalls.length > 0) {
				(entry as { tool_calls?: OAIToolCall[] }).tool_calls = toolCalls;
			}
			result.push(entry);
		}
	}
	return result;
}

function extractToolResultContent(
	block: Anthropic.Messages.ToolResultBlockParam,
): string {
	const prefix = block.is_error ? "[ERROR] " : "";
	if (typeof block.content === "string") return prefix + block.content;
	if (!block.content) return `${prefix}`;
	const texts = block.content
		.filter(
			(b): b is Anthropic.Messages.TextBlockParam => b.type === "text",
		)
		.map((b) => b.text);
	return prefix + texts.join("\n");
}

/** Convert Anthropic tool definitions to OpenAI format. */
export function toOpenAITools(tools: Anthropic.Tool[]): OAITool[] {
	return tools.map((t) => ({
		type: "function" as const,
		function: {
			name: t.name,
			description: t.description ?? "",
			parameters: t.input_schema as Record<string, unknown>,
		},
	}));
}

/** Map OpenAI finish_reason to Anthropic stop_reason. */
export function mapFinishReason(
	reason: string | null,
): Anthropic.Message["stop_reason"] {
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

/** Build an Anthropic.Message from accumulated OpenAI response data. */
export function buildAnthropicMessage(opts: {
	text: string;
	toolCalls: Array<{ id: string; name: string; input: unknown }>;
	stopReason: Anthropic.Message["stop_reason"];
	model: string;
	usage: { input: number; output: number };
}): Anthropic.Message {
	const content: Anthropic.ContentBlock[] = [];
	if (opts.text) {
		content.push({
			type: "text",
			text: opts.text,
			citations: null,
		} as Anthropic.ContentBlock);
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
		content.push({
			type: "text",
			text: "",
			citations: null,
		} as Anthropic.ContentBlock);
	}
	return {
		id: `msg_oai_${Date.now()}`,
		type: "message",
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
	} as Anthropic.Message;
}

// --- Streaming ---

class OpenAIStream implements MessageStream {
	private listeners = new Map<string, Array<(delta: string) => void>>();
	private messagePromise: Promise<Anthropic.Message>;

	constructor(fetchFn: () => Promise<Response>, model: string) {
		this.messagePromise = this.consume(fetchFn, model);
	}

	on(event: "text" | "thinking", cb: (delta: string) => void): this {
		const existing = this.listeners.get(event);
		if (existing) existing.push(cb);
		else this.listeners.set(event, [cb]);
		return this;
	}

	async finalMessage(): Promise<Anthropic.Message> {
		return this.messagePromise;
	}

	private emit(event: string, delta: string): void {
		const handlers = this.listeners.get(event);
		if (handlers) for (const h of handlers) h(delta);
	}

	private async consume(
		fetchFn: () => Promise<Response>,
		fallbackModel: string,
	): Promise<Anthropic.Message> {
		const response = await fetchFn();
		if (!response.ok) {
			const body = await response.text();
			throw new Error(`OpenAI API error ${response.status}: ${body}`);
		}

		let text = "";
		const toolCalls = new Map<
			number,
			{ id: string; name: string; args: string }
		>();
		let finishReason: string | null = null;
		let model = fallbackModel;
		let promptTokens = 0;
		let completionTokens = 0;

		const reader = response.body?.getReader();
		if (!reader) {
			throw new Error("Response body is not readable");
		}

		const decoder = new TextDecoder();
		let buffer = "";

		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });

			const lines = buffer.split("\n");
			buffer = lines.pop() ?? "";

			for (const line of lines) {
				if (!line.startsWith("data: ")) continue;
				const data = line.slice(6).trim();
				if (data === "[DONE]") continue;

				let chunk: OAIStreamChunk;
				try {
					chunk = JSON.parse(data);
				} catch {
					continue;
				}

				model = chunk.model || model;
				if (chunk.usage) {
					promptTokens = chunk.usage.prompt_tokens;
					completionTokens = chunk.usage.completion_tokens;
				}

				const choice = chunk.choices[0];
				if (!choice) continue;
				if (choice.finish_reason) finishReason = choice.finish_reason;

				const delta = choice.delta;
				if (delta.content) {
					text += delta.content;
					this.emit("text", delta.content);
				}

				if (delta.tool_calls) {
					for (const tc of delta.tool_calls) {
						const existing = toolCalls.get(tc.index);
						if (!existing) {
							toolCalls.set(tc.index, {
								id: tc.id || `call_${tc.index}`,
								name: tc.function?.name || "",
								args: tc.function?.arguments || "",
							});
						} else {
							if (tc.function?.arguments) {
								existing.args += tc.function.arguments;
							}
						}
					}
				}
			}
		}

		const parsedToolCalls = Array.from(toolCalls.values()).map((tc) => ({
			id: tc.id,
			name: tc.name,
			input: safeJsonParse(tc.args),
		}));

		return buildAnthropicMessage({
			text,
			toolCalls: parsedToolCalls,
			stopReason: mapFinishReason(finishReason),
			model,
			usage: { input: promptTokens, output: completionTokens },
		});
	}
}

function safeJsonParse(s: string): unknown {
	if (!s) return {};
	try {
		return JSON.parse(s);
	} catch {
		return { _raw: s };
	}
}

// --- Client ---

export type OpenAIClientOptions = {
	baseUrl: string;
	apiKey: string;
};

/** ModelClient backed by any OpenAI-compatible API (OpenAI, Ollama, Groq, etc.). */
export class OpenAIModelClient implements ModelClient {
	readonly messages: ModelClient["messages"];
	private baseUrl: string;
	private apiKey: string;

	constructor(options: OpenAIClientOptions) {
		this.baseUrl = options.baseUrl.replace(/\/+$/, "");
		this.apiKey = options.apiKey;

		this.messages = {
			stream: (params: MessageStreamParams) => this.doStream(params),
			create: (params: MessageCreateParams) => this.doCreate(params),
		};
	}

	private buildHeaders(): Record<string, string> {
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
		};
		if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;
		return headers;
	}

	private doStream(params: MessageStreamParams): MessageStream {
		const body = this.buildRequestBody(params, true);
		const url = `${this.baseUrl}/chat/completions`;
		const headers = this.buildHeaders();

		return new OpenAIStream(
			() => fetch(url, { method: "POST", headers, body: JSON.stringify(body) }),
			params.model,
		);
	}

	private async doCreate(
		params: MessageCreateParams,
	): Promise<Anthropic.Message> {
		const body = this.buildRequestBody(params, false);
		const url = `${this.baseUrl}/chat/completions`;

		const response = await fetch(url, {
			method: "POST",
			headers: this.buildHeaders(),
			body: JSON.stringify(body),
		});

		if (!response.ok) {
			const text = await response.text();
			throw new Error(`OpenAI API error ${response.status}: ${text}`);
		}

		const data = (await response.json()) as OAIResponse;
		const choice = data.choices[0];
		if (!choice) {
			throw new Error("OpenAI API returned no choices");
		}

		const textContent = choice.message.content ?? "";
		const toolCalls = (choice.message.tool_calls ?? []).map((tc) => ({
			id: tc.id,
			name: tc.function.name,
			input: safeJsonParse(tc.function.arguments),
		}));

		return buildAnthropicMessage({
			text: textContent,
			toolCalls,
			stopReason: mapFinishReason(choice.finish_reason),
			model: data.model || params.model,
			usage: {
				input: data.usage?.prompt_tokens ?? 0,
				output: data.usage?.completion_tokens ?? 0,
			},
		});
	}

	private buildRequestBody(
		params: MessageStreamParams | MessageCreateParams,
		stream: boolean,
	): Record<string, unknown> {
		const oaiMessages = toOpenAIMessages(params.system, params.messages);
		const body: Record<string, unknown> = {
			model: params.model,
			max_tokens: params.max_tokens,
			messages: oaiMessages,
			stream,
		};
		if ("tools" in params && params.tools?.length) {
			body.tools = toOpenAITools(params.tools);
		}
		if (stream) {
			body.stream_options = { include_usage: true };
		}
		return body;
	}
}
