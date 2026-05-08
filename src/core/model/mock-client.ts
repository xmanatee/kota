/**
 * Mock ModelClient for E2E testing.
 *
 * Simulates the streaming API so the full agent loop can be tested
 * without a real API key. Each call to messages.stream() returns the
 * next response in a pre-configured sequence.
 */

import type {
	KotaContentBlock,
	KotaMessage,
	KotaMessageStream,
	KotaModelResponse,
	KotaModelUsage,
	KotaTool,
} from "#core/agent-harness/message-protocol.js";
import type { ModelClient } from "./model-client.js";

type StreamListener = (delta: string) => void;

/**
 * Minimal mock of `KotaMessageStream`. Emits text/thinking events
 * and resolves finalMessage() with the pre-configured response.
 */
class MockStream implements KotaMessageStream {
	private listeners = new Map<string, StreamListener[]>();
	private resolved = false;

	constructor(private response: KotaModelResponse) {}

	on(event: "text" | "thinking", handler: StreamListener): this {
		const existing = this.listeners.get(event);
		if (existing) {
			existing.push(handler);
		} else {
			this.listeners.set(event, [handler]);
		}
		return this;
	}

	private emit(event: string, delta: string): void {
		const handlers = this.listeners.get(event);
		if (!handlers) return;
		for (const h of handlers) h(delta);
	}

	async finalMessage(): Promise<KotaModelResponse> {
		if (this.resolved) return this.response;
		this.resolved = true;

		// Emit events for each content block, simulating streaming behavior
		for (const block of this.response.content) {
			if (block.type === "text") {
				this.emit("text", block.text);
			}
			if (block.type === "thinking") {
				this.emit("thinking", block.thinking);
			}
		}
		return this.response;
	}
}

/** Record of what was sent to the mock API. */
export type MockApiCall = {
	model: string;
	messages: KotaMessage[];
	tools: KotaTool[];
	system: unknown;
};

/**
 * Create a mock ModelClient that returns pre-configured responses.
 *
 * Each call to `messages.stream()` pops the next response from the list.
 * If the list is exhausted, the last response is reused (so tests can
 * define just a final text response and have it repeat safely).
 *
 * Returns [client, calls] where `calls` accumulates every API request
 * for assertions.
 */
export function createMockClient(
	responses: KotaModelResponse[],
): [ModelClient, MockApiCall[]] {
	const calls: MockApiCall[] = [];
	let callIndex = 0;

	const client: ModelClient = {
		messages: {
			stream(params): KotaMessageStream {
				calls.push({
					model: params.model,
					messages: params.messages,
					tools: params.tools ?? [],
					system: params.system,
				});
				const idx = Math.min(callIndex, responses.length - 1);
				callIndex++;
				return new MockStream(responses[idx]);
			},
			async create(_params): Promise<KotaModelResponse> {
				const idx = Math.min(callIndex, responses.length - 1);
				callIndex++;
				return responses[idx];
			},
		},
	};

	return [client, calls];
}

// --- Response builders ---

/**
 * Sentinel model id stamped onto every mock response. Production code must not
 * read this constant as a default — the negative grep test enforces that no
 * literal `claude-*`/`gpt-*`/`gemini-*` id leaks into production paths, and a
 * sentinel keeps the mock untangled from any active preset.
 */
export const MOCK_MODEL_ID = "mock-test-model";

let msgCounter = 0;

function nextId(): string {
	msgCounter++;
	return `msg_mock_${msgCounter}`;
}

function defaultUsage(outputTokens: number): KotaModelUsage {
	return {
		input_tokens: 100,
		output_tokens: outputTokens,
		cache_creation_input_tokens: null,
		cache_read_input_tokens: null,
	};
}

/** Build a text-only response (agent stops with text). */
export function textResponse(
	text: string,
	usage?: Partial<KotaModelUsage>,
): KotaModelResponse {
	return {
		id: nextId(),
		role: "assistant",
		model: MOCK_MODEL_ID,
		content: [{ type: "text", text }],
		stop_reason: "end_turn",
		stop_sequence: null,
		usage: { ...defaultUsage(Math.ceil(text.length / 4)), ...usage },
	};
}

/** Build a tool-use response (agent calls a tool). */
export function toolUseResponse(
	toolName: string,
	toolInput: unknown,
	opts?: { text?: string; toolId?: string },
): KotaModelResponse {
	const content: KotaContentBlock[] = [];
	if (opts?.text) {
		content.push({ type: "text", text: opts.text });
	}
	content.push({
		type: "tool_use",
		id: opts?.toolId ?? `toolu_mock_${++msgCounter}`,
		name: toolName,
		input: toolInput,
	});
	return {
		id: nextId(),
		role: "assistant",
		model: MOCK_MODEL_ID,
		content,
		stop_reason: "tool_use",
		stop_sequence: null,
		usage: defaultUsage(50),
	};
}

/** Build a response with multiple tool calls. */
export function multiToolResponse(
	tools: Array<{ name: string; input: unknown; id?: string }>,
): KotaModelResponse {
	const content: KotaContentBlock[] = tools.map((t) => ({
		type: "tool_use",
		id: t.id ?? `toolu_mock_${++msgCounter}`,
		name: t.name,
		input: t.input,
	}));
	return {
		id: nextId(),
		role: "assistant",
		model: MOCK_MODEL_ID,
		content,
		stop_reason: "tool_use",
		stop_sequence: null,
		usage: defaultUsage(80),
	};
}

/** Reset the internal message counter (call between tests). */
export function resetMockIds(): void {
	msgCounter = 0;
}
