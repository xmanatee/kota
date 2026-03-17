/**
 * Mock Anthropic client for E2E testing.
 *
 * Simulates the streaming API so the full agent loop can be tested
 * without a real API key. Each call to messages.stream() returns the
 * next response in a pre-configured sequence.
 */

import type Anthropic from "@anthropic-ai/sdk";
import type { ModelClient } from "./model-client.js";

type Listener = (...args: unknown[]) => void;

/**
 * Minimal mock of the SDK's MessageStream. Emits text/thinking events
 * and resolves finalMessage() with the pre-configured response.
 */
class MockStream {
	private listeners = new Map<string, Listener[]>();
	private resolved = false;

	constructor(private response: Anthropic.Message) {}

	on(event: string, handler: Listener): this {
		const existing = this.listeners.get(event);
		if (existing) {
			existing.push(handler);
		} else {
			this.listeners.set(event, [handler]);
		}
		return this;
	}

	private emit(event: string, ...args: unknown[]): void {
		const handlers = this.listeners.get(event);
		if (!handlers) return;
		for (const h of handlers) h(...args);
	}

	async finalMessage(): Promise<Anthropic.Message> {
		if (this.resolved) return this.response;
		this.resolved = true;

		// Emit events for each content block, simulating streaming behavior
		for (const block of this.response.content) {
			if (block.type === "text") {
				this.emit("text", block.text, block.text);
			}
			if (block.type === "thinking" && "thinking" in block) {
				this.emit(
					"thinking",
					(block as { thinking: string }).thinking,
					(block as { thinking: string }).thinking,
				);
			}
		}
		return this.response;
	}
}

/** Record of what was sent to the mock API. */
export type MockApiCall = {
	model: string;
	messages: Anthropic.MessageParam[];
	tools: Anthropic.Tool[];
	system: unknown;
};

/**
 * Create a mock Anthropic client that returns pre-configured responses.
 *
 * Each call to `messages.stream()` pops the next response from the list.
 * If the list is exhausted, the last response is reused (so tests can
 * define just a final text response and have it repeat safely).
 *
 * Returns [client, calls] where `calls` accumulates every API request
 * for assertions.
 */
export function createMockClient(
	responses: Anthropic.Message[],
): [ModelClient, MockApiCall[]] {
	const calls: MockApiCall[] = [];
	let callIndex = 0;

	const client = {
		messages: {
			stream(params: Record<string, unknown>) {
				calls.push({
					model: params.model as string,
					messages: params.messages as Anthropic.MessageParam[],
					tools: params.tools as Anthropic.Tool[],
					system: params.system,
				});
				const idx = Math.min(callIndex, responses.length - 1);
				callIndex++;
				return new MockStream(responses[idx]);
			},
		},
	} as unknown as ModelClient;

	return [client, calls];
}

// --- Response builders ---

let msgCounter = 0;

function nextId(): string {
	msgCounter++;
	return `msg_mock_${msgCounter}`;
}

/** Build a text-only response (agent stops with text). */
export function textResponse(
	text: string,
	usage?: Partial<Anthropic.Message["usage"]>,
): Anthropic.Message {
	return {
		id: nextId(),
		type: "message",
		role: "assistant",
		model: "claude-haiku-4-5-20251001",
		content: [{ type: "text", text, citations: null }],
		stop_reason: "end_turn",
		stop_sequence: null,
		usage: {
			input_tokens: 100,
			output_tokens: Math.ceil(text.length / 4),
			cache_creation_input_tokens: null,
			cache_read_input_tokens: null,
			...usage,
		},
	} as Anthropic.Message;
}

/** Build a tool-use response (agent calls a tool). */
export function toolUseResponse(
	toolName: string,
	toolInput: unknown,
	opts?: { text?: string; toolId?: string },
): Anthropic.Message {
	const content: Anthropic.ContentBlock[] = [];
	if (opts?.text) {
		content.push({
			type: "text",
			text: opts.text,
			citations: null,
		} as Anthropic.ContentBlock);
	}
	content.push({
		type: "tool_use",
		id: opts?.toolId ?? `toolu_mock_${++msgCounter}`,
		name: toolName,
		input: toolInput,
	});
	return {
		id: nextId(),
		type: "message",
		role: "assistant",
		model: "claude-haiku-4-5-20251001",
		content,
		stop_reason: "tool_use",
		stop_sequence: null,
		usage: {
			input_tokens: 100,
			output_tokens: 50,
			cache_creation_input_tokens: null,
			cache_read_input_tokens: null,
		},
	} as Anthropic.Message;
}

/** Build a response with multiple tool calls. */
export function multiToolResponse(
	tools: Array<{ name: string; input: unknown; id?: string }>,
): Anthropic.Message {
	const content: Anthropic.ContentBlock[] = tools.map((t) => ({
		type: "tool_use" as const,
		id: t.id ?? `toolu_mock_${++msgCounter}`,
		name: t.name,
		input: t.input,
	}));
	return {
		id: nextId(),
		type: "message",
		role: "assistant",
		model: "claude-haiku-4-5-20251001",
		content,
		stop_reason: "tool_use",
		stop_sequence: null,
		usage: {
			input_tokens: 100,
			output_tokens: 80,
			cache_creation_input_tokens: null,
			cache_read_input_tokens: null,
		},
	} as Anthropic.Message;
}

/** Reset the internal message counter (call between tests). */
export function resetMockIds(): void {
	msgCounter = 0;
}
