import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, } from "vitest";
import type {
	MessageCreateParams,
	MessageStream,
	MessageStreamParams,
	ModelClient,
} from "./model-client.js";

// --- Interface compliance helpers ---

function createMockStream(response: Anthropic.Message): MessageStream {
	const listeners = new Map<string, Array<(delta: string) => void>>();

	const stream: MessageStream = {
		on(event: "text" | "thinking", cb: (delta: string) => void) {
			const existing = listeners.get(event);
			if (existing) existing.push(cb);
			else listeners.set(event, [cb]);
			return stream;
		},
		async finalMessage() {
			for (const block of response.content) {
				if (block.type === "text") {
					for (const h of listeners.get("text") ?? []) h(block.text);
				}
			}
			return response;
		},
	};
	return stream;
}

function mockResponse(text: string): Anthropic.Message {
	return {
		id: "msg_test_1",
		type: "message",
		role: "assistant",
		model: "test-model",
		content: [{ type: "text", text, citations: null }],
		stop_reason: "end_turn",
		stop_sequence: null,
		usage: {
			input_tokens: 10,
			output_tokens: 5,
			cache_creation_input_tokens: null,
			cache_read_input_tokens: null,
		},
	} as Anthropic.Message;
}

function createTestClient(responses: Anthropic.Message[]): ModelClient {
	let idx = 0;
	return {
		messages: {
			stream(_params: MessageStreamParams) {
				const resp = responses[Math.min(idx++, responses.length - 1)];
				return createMockStream(resp);
			},
			async create(_params: MessageCreateParams) {
				return responses[Math.min(idx++, responses.length - 1)];
			},
		},
	};
}

// --- Tests ---

describe("ModelClient interface", () => {
	it("stream returns a MessageStream with on() and finalMessage()", async () => {
		const resp = mockResponse("Hello from stream");
		const client = createTestClient([resp]);

		const stream = client.messages.stream({
			model: "test",
			max_tokens: 100,
			messages: [{ role: "user", content: "hi" }],
		});

		const chunks: string[] = [];
		stream.on("text", (delta) => chunks.push(delta));
		const final = await stream.finalMessage();

		expect(final.content[0].type).toBe("text");
		expect(chunks).toEqual(["Hello from stream"]);
	});

	it("stream on() returns this for chaining", () => {
		const client = createTestClient([mockResponse("test")]);
		const stream = client.messages.stream({
			model: "test",
			max_tokens: 100,
			messages: [{ role: "user", content: "hi" }],
		});

		const result = stream.on("text", () => {});
		expect(result).toBe(stream);
	});

	it("create returns a Message directly", async () => {
		const resp = mockResponse("Hello from create");
		const client = createTestClient([resp]);

		const result = await client.messages.create({
			model: "test",
			max_tokens: 100,
			system: "You are helpful.",
			messages: [{ role: "user", content: "hi" }],
		});

		expect(result.id).toBe("msg_test_1");
		expect(result.content[0].type).toBe("text");
	});

	it("stream accepts tools and thinking params", async () => {
		const client = createTestClient([mockResponse("ok")]);

		const stream = client.messages.stream({
			model: "test",
			max_tokens: 100,
			messages: [{ role: "user", content: "hi" }],
			tools: [
				{
					name: "test_tool",
					description: "A test tool",
					input_schema: {
						type: "object" as const,
						properties: {},
					},
				},
			],
			thinking: { type: "enabled", budget_tokens: 1000 },
		});

		const final = await stream.finalMessage();
		expect(final.stop_reason).toBe("end_turn");
	});

	it("stream accepts system as TextBlockParam array", async () => {
		const client = createTestClient([mockResponse("ok")]);

		const stream = client.messages.stream({
			model: "test",
			max_tokens: 100,
			system: [{ type: "text", text: "System prompt" }],
			messages: [{ role: "user", content: "hi" }],
		});

		const final = await stream.finalMessage();
		expect(final).toBeDefined();
	});

	it("stream accepts system as string", async () => {
		const client = createTestClient([mockResponse("ok")]);

		const stream = client.messages.stream({
			model: "test",
			max_tokens: 100,
			system: "System prompt string",
			messages: [{ role: "user", content: "hi" }],
		});

		const final = await stream.finalMessage();
		expect(final).toBeDefined();
	});

	it("thinking event fires on stream", async () => {
		const resp: Anthropic.Message = {
			id: "msg_think",
			type: "message",
			role: "assistant",
			model: "test",
			content: [{ type: "text", text: "answer", citations: null }],
			stop_reason: "end_turn",
			stop_sequence: null,
			usage: {
				input_tokens: 10,
				output_tokens: 5,
				cache_creation_input_tokens: null,
				cache_read_input_tokens: null,
			},
		} as Anthropic.Message;

		const client = createTestClient([resp]);
		const stream = client.messages.stream({
			model: "test",
			max_tokens: 100,
			messages: [{ role: "user", content: "think" }],
		});

		const thinkingChunks: string[] = [];
		stream.on("thinking", (delta) => thinkingChunks.push(delta));
		await stream.finalMessage();

		// No thinking blocks in the response, so no events
		expect(thinkingChunks).toEqual([]);
	});

	it("multiple text events fire in order", async () => {
		const resp: Anthropic.Message = {
			id: "msg_multi",
			type: "message",
			role: "assistant",
			model: "test",
			content: [
				{ type: "text", text: "first", citations: null },
				{ type: "text", text: "second", citations: null },
			],
			stop_reason: "end_turn",
			stop_sequence: null,
			usage: {
				input_tokens: 10,
				output_tokens: 10,
				cache_creation_input_tokens: null,
				cache_read_input_tokens: null,
			},
		} as Anthropic.Message;

		const client = createTestClient([resp]);
		const stream = client.messages.stream({
			model: "test",
			max_tokens: 100,
			messages: [{ role: "user", content: "multi" }],
		});

		const chunks: string[] = [];
		stream.on("text", (delta) => chunks.push(delta));
		await stream.finalMessage();

		expect(chunks).toEqual(["first", "second"]);
	});

	it("client satisfies ModelClient interface structurally", () => {
		// Verify that a plain object with the right shape satisfies ModelClient
		const client: ModelClient = {
			messages: {
				stream: () => ({
					on: () => ({}) as MessageStream,
					finalMessage: async () => mockResponse("ok"),
				}),
				create: async () => mockResponse("ok"),
			},
		};
		expect(client.messages.stream).toBeDefined();
		expect(client.messages.create).toBeDefined();
	});
});
