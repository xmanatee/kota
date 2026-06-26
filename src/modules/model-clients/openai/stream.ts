/**
 * SSE stream consumer for OpenAI-compatible chat completion endpoints.
 */

import type {
	KotaMessageStream,
	KotaModelResponse,
} from "#core/agent-harness/message-protocol.js";
import {
	buildKotaModelResponse,
	extractReasoningText,
	mapFinishReason,
	openAIUsageToKotaUsage,
	safeJsonParse,
} from "./translations.js";
import type { OAIReasoningDeltaEvent, OAIStreamChunk } from "./types.js";

export class OpenAIStream implements KotaMessageStream {
	private listeners = new Map<string, Array<(delta: string) => void>>();
	private messagePromise: Promise<KotaModelResponse>;

	constructor(fetchFn: () => Promise<Response>, model: string) {
		this.messagePromise = this.consume(fetchFn, model);
	}

	on(event: "text" | "thinking", cb: (delta: string) => void): this {
		const existing = this.listeners.get(event);
		if (existing) existing.push(cb);
		else this.listeners.set(event, [cb]);
		return this;
	}

	async finalMessage(): Promise<KotaModelResponse> {
		return this.messagePromise;
	}

	private emit(event: string, delta: string): void {
		const handlers = this.listeners.get(event);
		if (handlers) for (const h of handlers) h(delta);
	}

	private async consume(
		fetchFn: () => Promise<Response>,
		fallbackModel: string,
	): Promise<KotaModelResponse> {
		const response = await fetchFn();
		if (!response.ok) {
			const body = await response.text();
			throw new Error(`OpenAI API error ${response.status}: ${body}`);
		}

		let text = "";
		let thinking = "";
		const toolCalls = new Map<
			number,
			{ id: string; name: string; args: string }
		>();
		let finishReason: string | null = null;
		let model = fallbackModel;
		let usage = openAIUsageToKotaUsage(undefined);

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

				let parsed: OAIStreamChunk | OAIReasoningDeltaEvent;
				try {
					parsed = JSON.parse(data);
				} catch {
					continue;
				}
				if (isReasoningDeltaEvent(parsed)) {
					thinking += parsed.delta;
					this.emit("thinking", parsed.delta);
					if (parsed.model) model = parsed.model;
					continue;
				}

				const chunk = parsed;
				model = chunk.model || model;
				if (chunk.usage) {
					usage = openAIUsageToKotaUsage(chunk.usage);
				}

				const choice = chunk.choices[0];
				if (!choice) continue;
				if (choice.finish_reason) finishReason = choice.finish_reason;

				const delta = choice.delta;
				if (delta.content) {
					text += delta.content;
					this.emit("text", delta.content);
				}
				const reasoningDelta = extractReasoningText(delta);
				if (reasoningDelta) {
					thinking += reasoningDelta;
					this.emit("thinking", reasoningDelta);
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
							if (tc.id) {
								existing.id = tc.id;
							}
							if (tc.function?.name) {
								existing.name += tc.function.name;
							}
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

		return buildKotaModelResponse({
			text,
			...(thinking ? { thinking } : {}),
			toolCalls: parsedToolCalls,
			stopReason: mapFinishReason(finishReason),
			model,
			usage,
		});
	}
}

function isReasoningDeltaEvent(
	value: OAIStreamChunk | OAIReasoningDeltaEvent,
): value is OAIReasoningDeltaEvent {
	return "type" in value && value.type === "response.reasoning.delta";
}
