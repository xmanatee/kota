import { describe, expect, it, type Mock, vi } from "vitest";
import type {
	KotaTextBlock,
	KotaToolUseBlock,
} from "#core/agent-harness/message-protocol.js";
import { outboundHttpStreamingPort } from "#core/outbound-http/testing/request-port.js";
import {
	type OpenAIClientOptions,
	OpenAIModelClient,
} from "./openai/index.js";

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
	let activeFetch = vi.fn();
	const http = outboundHttpStreamingPort((request) =>
		activeFetch(String(request.url), {
			method: request.method,
			headers: request.headers,
			body: request.body,
			signal: request.signal,
		})
	);

	function makeClient(options: OpenAIClientOptions): OpenAIModelClient {
		return new OpenAIModelClient({ ...options, http });
	}

	function setupMockFetch(response: Response): Mock {
		const mock = vi.fn().mockResolvedValue(response);
		activeFetch = mock;
		return mock;
	}

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

			const client = makeClient({
				baseUrl: "http://localhost:11434/v1",
				apiKey: "test-key", presetName: "ollama",
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
			expect((result.content[0] as KotaTextBlock).text).toBe("Hello!");

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

			const client = makeClient({
				baseUrl: "http://localhost/v1",
				apiKey: "k", presetName: "test",
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

			const client = makeClient({
				baseUrl: "http://localhost:11434/v1///",
				apiKey: "", presetName: "test",
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

			const client = makeClient({
				baseUrl: "http://localhost/v1",
				apiKey: "", presetName: "test",
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

			const client = makeClient({
				baseUrl: "http://localhost/v1",
				apiKey: "key", presetName: "test",
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
			expect((msg.content[0] as KotaTextBlock).text).toBe(
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

			const client = makeClient({
				baseUrl: "http://localhost/v1",
				apiKey: "key", presetName: "test",
			});

			const stream = client.messages.stream({
				model: "gpt-4o",
				max_tokens: 100,
				messages: [{ role: "user", content: "search test" }],
			});
			const msg = await stream.finalMessage();

			expect(msg.stop_reason).toBe("tool_use");
			expect(msg.content).toHaveLength(1);
			const tc = msg.content[0] as KotaToolUseBlock;
			expect(tc.type).toBe("tool_use");
			expect(tc.id).toBe("call_1");
			expect(tc.name).toBe("search");
			expect(tc.input).toEqual({ q: "test" });
		});

		it("handles stream error response", async () => {
			setupMockFetch({
				ok: false,
				status: 500,
				text: () => Promise.resolve("Internal Server Error"),
				body: null,
			} as Response);

			const client = makeClient({
				baseUrl: "http://localhost/v1",
				apiKey: "key", presetName: "test",
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

			const client = makeClient({
				baseUrl: "http://localhost/v1",
				apiKey: "", presetName: "test",
			});

			const stream = client.messages.stream({
				model: "test",
				max_tokens: 100,
				messages: [{ role: "user", content: "hi" }],
			});
			const msg = await stream.finalMessage();
			expect((msg.content[0] as KotaTextBlock).text).toBe("ok");
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
