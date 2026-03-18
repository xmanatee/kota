import type Anthropic from "@anthropic-ai/sdk";
import { afterEach, describe, expect, it, type Mock, vi } from "vitest";
import type { ModelClient } from "./model/model-client.js";
import {
	buildAnthropicMessage,
	mapFinishReason,
	OpenAIModelClient,
	systemToText,
	toOpenAIMessages,
	toOpenAITools,
} from "./openai/index.js";

// --- Translation function tests ---

describe("systemToText", () => {
	it("returns undefined for undefined", () => {
		expect(systemToText(undefined)).toBeUndefined();
	});

	it("passes through string", () => {
		expect(systemToText("hello")).toBe("hello");
	});

	it("joins TextBlockParam array", () => {
		const blocks = [
			{ type: "text" as const, text: "first" },
			{ type: "text" as const, text: "second" },
		];
		expect(systemToText(blocks)).toBe("first\n\nsecond");
	});
});

describe("toOpenAIMessages", () => {
	it("prepends system message", () => {
		const result = toOpenAIMessages("You are helpful.", [
			{ role: "user", content: "hi" },
		]);
		expect(result[0]).toEqual({ role: "system", content: "You are helpful." });
		expect(result[1]).toEqual({ role: "user", content: "hi" });
	});

	it("omits system if undefined", () => {
		const result = toOpenAIMessages(undefined, [
			{ role: "user", content: "hi" },
		]);
		expect(result).toHaveLength(1);
		expect(result[0]).toEqual({ role: "user", content: "hi" });
	});

	it("converts user string content", () => {
		const result = toOpenAIMessages(undefined, [
			{ role: "user", content: "hello" },
		]);
		expect(result).toEqual([{ role: "user", content: "hello" }]);
	});

	it("converts user text blocks", () => {
		const result = toOpenAIMessages(undefined, [
			{
				role: "user",
				content: [
					{ type: "text", text: "line1" },
					{ type: "text", text: "line2" },
				],
			},
		]);
		expect(result).toEqual([{ role: "user", content: "line1\nline2" }]);
	});

	it("converts tool_result blocks to tool messages", () => {
		const result = toOpenAIMessages(undefined, [
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "toolu_1",
						content: "result text",
					},
				],
			},
		]);
		expect(result).toEqual([
			{ role: "tool", tool_call_id: "toolu_1", content: "result text" },
		]);
	});

	it("handles tool_result with is_error", () => {
		const result = toOpenAIMessages(undefined, [
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "t1",
						content: "failed",
						is_error: true,
					},
				],
			},
		]);
		expect(result[0]).toEqual({
			role: "tool",
			tool_call_id: "t1",
			content: "[ERROR] failed",
		});
	});

	it("handles mixed text + tool_result in user message", () => {
		const result = toOpenAIMessages(undefined, [
			{
				role: "user",
				content: [
					{ type: "text", text: "context" },
					{
						type: "tool_result",
						tool_use_id: "t1",
						content: "result",
					},
				],
			},
		]);
		expect(result).toEqual([
			{ role: "user", content: "context" },
			{ role: "tool", tool_call_id: "t1", content: "result" },
		]);
	});

	it("converts assistant string content", () => {
		const result = toOpenAIMessages(undefined, [
			{ role: "assistant", content: "reply" },
		]);
		expect(result).toEqual([{ role: "assistant", content: "reply" }]);
	});

	it("converts assistant with tool_use blocks", () => {
		const result = toOpenAIMessages(undefined, [
			{
				role: "assistant",
				content: [
					{ type: "text", text: "Let me check" },
					{
						type: "tool_use",
						id: "toolu_1",
						name: "get_weather",
						input: { city: "SF" },
					},
				],
			},
		]);
		expect(result).toEqual([
			{
				role: "assistant",
				content: "Let me check",
				tool_calls: [
					{
						id: "toolu_1",
						type: "function",
						function: {
							name: "get_weather",
							arguments: '{"city":"SF"}',
						},
					},
				],
			},
		]);
	});

	it("sets assistant content to null when only tool_use", () => {
		const result = toOpenAIMessages(undefined, [
			{
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "t1",
						name: "func",
						input: {},
					},
				],
			},
		]);
		const msg = result[0] as { role: string; content: string | null };
		expect(msg.content).toBeNull();
	});

	it("skips thinking blocks in assistant messages", () => {
		const result = toOpenAIMessages(undefined, [
			{
				role: "assistant",
				content: [
					{ type: "thinking", thinking: "hmm..." } as unknown as Anthropic.ContentBlockParam,
					{ type: "text", text: "answer" },
				],
			},
		]);
		expect(result).toEqual([{ role: "assistant", content: "answer" }]);
	});
});

describe("toOpenAITools", () => {
	it("converts Anthropic tools to OpenAI format", () => {
		const tools: Anthropic.Tool[] = [
			{
				name: "search",
				description: "Search the web",
				input_schema: {
					type: "object" as const,
					properties: { query: { type: "string" } },
					required: ["query"],
				},
			},
		];
		expect(toOpenAITools(tools)).toEqual([
			{
				type: "function",
				function: {
					name: "search",
					description: "Search the web",
					parameters: {
						type: "object",
						properties: { query: { type: "string" } },
						required: ["query"],
					},
				},
			},
		]);
	});

	it("handles empty description", () => {
		const tools = [
			{ name: "noop", input_schema: { type: "object" as const } },
		] as Anthropic.Tool[];
		const result = toOpenAITools(tools);
		expect(result[0].function.description).toBe("");
	});
});

describe("mapFinishReason", () => {
	it("maps stop to end_turn", () => {
		expect(mapFinishReason("stop")).toBe("end_turn");
	});
	it("maps tool_calls to tool_use", () => {
		expect(mapFinishReason("tool_calls")).toBe("tool_use");
	});
	it("maps length to max_tokens", () => {
		expect(mapFinishReason("length")).toBe("max_tokens");
	});
	it("defaults to end_turn", () => {
		expect(mapFinishReason(null)).toBe("end_turn");
		expect(mapFinishReason("unknown")).toBe("end_turn");
	});
});

describe("buildAnthropicMessage", () => {
	it("builds text-only message", () => {
		const msg = buildAnthropicMessage({
			text: "Hello",
			toolCalls: [],
			stopReason: "end_turn",
			model: "gpt-4o",
			usage: { input: 10, output: 5 },
		});
		expect(msg.role).toBe("assistant");
		expect(msg.model).toBe("gpt-4o");
		expect(msg.stop_reason).toBe("end_turn");
		expect(msg.content).toHaveLength(1);
		expect(msg.content[0].type).toBe("text");
		expect((msg.content[0] as Anthropic.TextBlock).text).toBe("Hello");
		expect(msg.usage.input_tokens).toBe(10);
		expect(msg.usage.output_tokens).toBe(5);
	});

	it("builds message with tool calls", () => {
		const msg = buildAnthropicMessage({
			text: "",
			toolCalls: [{ id: "call_1", name: "search", input: { q: "test" } }],
			stopReason: "tool_use",
			model: "gpt-4o",
			usage: { input: 20, output: 15 },
		});
		expect(msg.stop_reason).toBe("tool_use");
		expect(msg.content).toHaveLength(1);
		expect(msg.content[0].type).toBe("tool_use");
		const tc = msg.content[0] as Anthropic.ToolUseBlock;
		expect(tc.name).toBe("search");
		expect(tc.input).toEqual({ q: "test" });
	});

	it("builds message with text and tool calls", () => {
		const msg = buildAnthropicMessage({
			text: "Searching...",
			toolCalls: [{ id: "c1", name: "search", input: {} }],
			stopReason: "tool_use",
			model: "test",
			usage: { input: 0, output: 0 },
		});
		expect(msg.content).toHaveLength(2);
		expect(msg.content[0].type).toBe("text");
		expect(msg.content[1].type).toBe("tool_use");
	});

	it("adds empty text block when no content", () => {
		const msg = buildAnthropicMessage({
			text: "",
			toolCalls: [],
			stopReason: "end_turn",
			model: "test",
			usage: { input: 0, output: 0 },
		});
		expect(msg.content).toHaveLength(1);
		expect((msg.content[0] as Anthropic.TextBlock).text).toBe("");
	});
});

// --- Client integration tests with mocked fetch ---

function mockFetchResponse(body: unknown, status = 200): Response {
	return {
		ok: status >= 200 && status < 300,
		status,
		statusText: status === 200 ? "OK" : "Error",
		headers: new Headers(),
		text: () => Promise.resolve(JSON.stringify(body)),
		json: () => Promise.resolve(body),
		body: null,
	} as unknown as Response;
}

function sseChunks(events: string[]): ReadableStream<Uint8Array> {
	const encoder = new TextEncoder();
	const data = events.map((e) => `data: ${e}\n\n`).join("");
	return new ReadableStream({
		start(controller) {
			controller.enqueue(encoder.encode(data));
			controller.close();
		},
	});
}

function mockStreamResponse(events: string[]): Response {
	return {
		ok: true,
		status: 200,
		body: sseChunks(events),
	} as unknown as Response;
}

describe("OpenAIModelClient", () => {
	let originalFetch: typeof globalThis.fetch;

	afterEach(() => {
		if (originalFetch) globalThis.fetch = originalFetch;
	});

	function setupMockFetch(response: Response): Mock {
		originalFetch = globalThis.fetch;
		const mock = vi.fn().mockResolvedValue(response);
		globalThis.fetch = mock;
		return mock;
	}

	it("satisfies ModelClient interface", () => {
		const client: ModelClient = new OpenAIModelClient({
			baseUrl: "http://localhost:11434/v1",
			apiKey: "test",
		});
		expect(client.messages.stream).toBeDefined();
		expect(client.messages.create).toBeDefined();
	});

	describe("create", () => {
		it("translates request and response", async () => {
			const oaiResponse: OAIResponse = {
				id: "chatcmpl-123",
				choices: [
					{
						message: { role: "assistant", content: "Hello!" },
						finish_reason: "stop",
					},
				],
				model: "llama3",
				usage: { prompt_tokens: 10, completion_tokens: 5 },
			};
			const mock = setupMockFetch(mockFetchResponse(oaiResponse));

			const client = new OpenAIModelClient({
				baseUrl: "http://localhost:11434/v1",
				apiKey: "test-key",
			});

			const result = await client.messages.create({
				model: "llama3",
				max_tokens: 100,
				system: "Be helpful.",
				messages: [{ role: "user", content: "hi" }],
			});

			expect(result.role).toBe("assistant");
			expect(result.model).toBe("llama3");
			expect(result.stop_reason).toBe("end_turn");
			expect((result.content[0] as Anthropic.TextBlock).text).toBe("Hello!");

			// Verify the request was sent correctly
			const [url, opts] = mock.mock.calls[0];
			expect(url).toBe("http://localhost:11434/v1/chat/completions");
			const body = JSON.parse(opts.body);
			expect(body.model).toBe("llama3");
			expect(body.stream).toBe(false);
			expect(body.messages[0]).toEqual({
				role: "system",
				content: "Be helpful.",
			});
			expect(body.messages[1]).toEqual({ role: "user", content: "hi" });
		});

		it("handles tool_calls in response", async () => {
			const oaiResponse: OAIResponse = {
				id: "chatcmpl-456",
				choices: [
					{
						message: {
							role: "assistant",
							content: null,
							tool_calls: [
								{
									id: "call_1",
									type: "function",
									function: {
										name: "search",
										arguments: '{"q":"weather"}',
									},
								},
							],
						},
						finish_reason: "tool_calls",
					},
				],
				model: "gpt-4o",
				usage: { prompt_tokens: 20, completion_tokens: 10 },
			};
			setupMockFetch(mockFetchResponse(oaiResponse));

			const client = new OpenAIModelClient({
				baseUrl: "https://api.openai.com/v1",
				apiKey: "sk-test",
			});

			const result = await client.messages.create({
				model: "gpt-4o",
				max_tokens: 200,
				messages: [{ role: "user", content: "search for weather" }],
			});

			expect(result.stop_reason).toBe("tool_use");
			expect(result.content[0].type).toBe("tool_use");
			const tc = result.content[0] as Anthropic.ToolUseBlock;
			expect(tc.name).toBe("search");
			expect(tc.input).toEqual({ q: "weather" });
		});

		it("throws on HTTP error", async () => {
			setupMockFetch(
				mockFetchResponse({ error: "unauthorized" }, 401),
			);

			const client = new OpenAIModelClient({
				baseUrl: "http://localhost/v1",
				apiKey: "",
			});

			await expect(
				client.messages.create({
					model: "test",
					max_tokens: 100,
					messages: [{ role: "user", content: "hi" }],
				}),
			).rejects.toThrow("OpenAI API error 401");
		});

		it("sends tools in request body", async () => {
			const streamEvents = [
				JSON.stringify({
					id: "c1",
					choices: [{ index: 0, delta: { content: "ok" }, finish_reason: "stop" }],
					model: "test",
				}),
				"[DONE]",
			];
			const mock = setupMockFetch(mockStreamResponse(streamEvents));

			const client = new OpenAIModelClient({
				baseUrl: "http://localhost/v1",
				apiKey: "k",
			});

			const stream = client.messages.stream({
				model: "test",
				max_tokens: 100,
				messages: [{ role: "user", content: "hi" }],
				tools: [
					{
						name: "my_tool",
						description: "A tool",
						input_schema: { type: "object" as const, properties: {} },
					},
				],
			});
			await stream.finalMessage();

			const sentBody = JSON.parse(mock.mock.calls[0][1].body);
			expect(sentBody.tools).toEqual([
				{
					type: "function",
					function: {
						name: "my_tool",
						description: "A tool",
						parameters: { type: "object", properties: {} },
					},
				},
			]);
		});

		it("strips trailing slashes from baseUrl", async () => {
			const oaiResponse: OAIResponse = {
				id: "c1",
				choices: [
					{
						message: { role: "assistant", content: "ok" },
						finish_reason: "stop",
					},
				],
				model: "test",
			};
			const mock = setupMockFetch(mockFetchResponse(oaiResponse));

			const client = new OpenAIModelClient({
				baseUrl: "http://localhost:11434/v1///",
				apiKey: "",
			});

			await client.messages.create({
				model: "test",
				max_tokens: 100,
				messages: [{ role: "user", content: "hi" }],
			});

			expect(mock.mock.calls[0][0]).toBe(
				"http://localhost:11434/v1/chat/completions",
			);
		});

		it("omits Authorization header when apiKey is empty", async () => {
			const oaiResponse: OAIResponse = {
				id: "c1",
				choices: [
					{
						message: { role: "assistant", content: "ok" },
						finish_reason: "stop",
					},
				],
				model: "test",
			};
			const mock = setupMockFetch(mockFetchResponse(oaiResponse));

			const client = new OpenAIModelClient({
				baseUrl: "http://localhost/v1",
				apiKey: "",
			});

			await client.messages.create({
				model: "test",
				max_tokens: 100,
				messages: [{ role: "user", content: "hi" }],
			});

			const headers = mock.mock.calls[0][1].headers;
			expect(headers.Authorization).toBeUndefined();
		});
	});

	describe("stream", () => {
		it("streams text and returns final message", async () => {
			const events = [
				JSON.stringify({
					id: "c1",
					choices: [
						{ index: 0, delta: { role: "assistant", content: "Hello" }, finish_reason: null },
					],
					model: "llama3",
				}),
				JSON.stringify({
					id: "c1",
					choices: [
						{ index: 0, delta: { content: " world" }, finish_reason: null },
					],
					model: "llama3",
				}),
				JSON.stringify({
					id: "c1",
					choices: [
						{ index: 0, delta: {}, finish_reason: "stop" },
					],
					model: "llama3",
					usage: { prompt_tokens: 10, completion_tokens: 5 },
				}),
				"[DONE]",
			];
			setupMockFetch(mockStreamResponse(events));

			const client = new OpenAIModelClient({
				baseUrl: "http://localhost/v1",
				apiKey: "key",
			});

			const textChunks: string[] = [];
			const stream = client.messages.stream({
				model: "llama3",
				max_tokens: 100,
				messages: [{ role: "user", content: "hi" }],
			});
			stream.on("text", (delta) => textChunks.push(delta));
			const msg = await stream.finalMessage();

			expect(textChunks).toEqual(["Hello", " world"]);
			expect(msg.stop_reason).toBe("end_turn");
			expect(msg.model).toBe("llama3");
			expect((msg.content[0] as Anthropic.TextBlock).text).toBe(
				"Hello world",
			);
			expect(msg.usage.input_tokens).toBe(10);
			expect(msg.usage.output_tokens).toBe(5);
		});

		it("streams tool calls", async () => {
			const events = [
				JSON.stringify({
					id: "c1",
					choices: [
						{
							index: 0,
							delta: {
								role: "assistant",
								tool_calls: [
									{
										index: 0,
										id: "call_1",
										type: "function",
										function: { name: "search", arguments: "" },
									},
								],
							},
							finish_reason: null,
						},
					],
					model: "gpt-4o",
				}),
				JSON.stringify({
					id: "c1",
					choices: [
						{
							index: 0,
							delta: {
								tool_calls: [
									{ index: 0, function: { arguments: '{"q":"test' } },
								],
							},
							finish_reason: null,
						},
					],
					model: "gpt-4o",
				}),
				JSON.stringify({
					id: "c1",
					choices: [
						{
							index: 0,
							delta: {
								tool_calls: [
									{ index: 0, function: { arguments: '"}' } },
								],
							},
							finish_reason: null,
						},
					],
					model: "gpt-4o",
				}),
				JSON.stringify({
					id: "c1",
					choices: [
						{ index: 0, delta: {}, finish_reason: "tool_calls" },
					],
					model: "gpt-4o",
				}),
				"[DONE]",
			];
			setupMockFetch(mockStreamResponse(events));

			const client = new OpenAIModelClient({
				baseUrl: "http://localhost/v1",
				apiKey: "key",
			});

			const stream = client.messages.stream({
				model: "gpt-4o",
				max_tokens: 100,
				messages: [{ role: "user", content: "search test" }],
			});
			const msg = await stream.finalMessage();

			expect(msg.stop_reason).toBe("tool_use");
			expect(msg.content).toHaveLength(1);
			const tc = msg.content[0] as Anthropic.ToolUseBlock;
			expect(tc.type).toBe("tool_use");
			expect(tc.id).toBe("call_1");
			expect(tc.name).toBe("search");
			expect(tc.input).toEqual({ q: "test" });
		});

		it("handles stream error response", async () => {
			originalFetch = globalThis.fetch;
			globalThis.fetch = vi.fn().mockResolvedValue({
				ok: false,
				status: 500,
				text: () => Promise.resolve("Internal Server Error"),
				body: null,
			});

			const client = new OpenAIModelClient({
				baseUrl: "http://localhost/v1",
				apiKey: "key",
			});

			const stream = client.messages.stream({
				model: "test",
				max_tokens: 100,
				messages: [{ role: "user", content: "hi" }],
			});

			await expect(stream.finalMessage()).rejects.toThrow(
				"OpenAI API error 500",
			);
		});

		it("on() returns this for chaining", () => {
			originalFetch = globalThis.fetch;
			globalThis.fetch = vi
				.fn()
				.mockResolvedValue(mockStreamResponse(["[DONE]"]));

			const client = new OpenAIModelClient({
				baseUrl: "http://localhost/v1",
				apiKey: "",
			});

			const stream = client.messages.stream({
				model: "test",
				max_tokens: 100,
				messages: [{ role: "user", content: "hi" }],
			});

			const result = stream.on("text", () => {});
			expect(result).toBe(stream);
		});

		it("handles malformed JSON in stream gracefully", async () => {
			const events = [
				"not-json",
				JSON.stringify({
					id: "c1",
					choices: [
						{ index: 0, delta: { content: "ok" }, finish_reason: "stop" },
					],
					model: "test",
				}),
				"[DONE]",
			];
			setupMockFetch(mockStreamResponse(events));

			const client = new OpenAIModelClient({
				baseUrl: "http://localhost/v1",
				apiKey: "",
			});

			const stream = client.messages.stream({
				model: "test",
				max_tokens: 100,
				messages: [{ role: "user", content: "hi" }],
			});
			const msg = await stream.finalMessage();
			expect((msg.content[0] as Anthropic.TextBlock).text).toBe("ok");
		});
	});
});

// Type used only for test assertions
type OAIResponse = {
	id: string;
	choices: Array<{
		message: { role: string; content: string | null; tool_calls?: unknown[] };
		finish_reason: string;
	}>;
	model: string;
	usage?: { prompt_tokens: number; completion_tokens: number };
};
