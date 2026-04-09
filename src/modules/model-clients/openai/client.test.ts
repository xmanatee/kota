import type Anthropic from "@anthropic-ai/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ModelClient } from "../../../model/model-client.js";
import { OpenAIModelClient } from "./client.js";
import type { OAIResponse } from "./types.js";

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

describe("OpenAIModelClient", () => {
	let originalFetch: typeof globalThis.fetch;

	afterEach(() => {
		if (originalFetch) globalThis.fetch = originalFetch;
	});

	function setupMockFetch(response: Response) {
		originalFetch = globalThis.fetch;
		const mock = vi.fn().mockResolvedValue(response);
		globalThis.fetch = mock;
		return mock;
	}

	it("satisfies ModelClient interface", () => {
		const client: ModelClient = new OpenAIModelClient({
			baseUrl: "http://localhost/v1",
			apiKey: "k",
		});
		expect(client.messages).toBeDefined();
	});

	it("throws on no choices in create response", async () => {
		const resp: OAIResponse = {
			id: "c1",
			choices: [],
			model: "test",
		};
		setupMockFetch(mockFetchResponse(resp));
		const client = new OpenAIModelClient({ baseUrl: "http://localhost/v1", apiKey: "k" });
		await expect(
			client.messages.create({
				model: "test",
				max_tokens: 100,
				messages: [{ role: "user", content: "hi" }],
			}),
		).rejects.toThrow("no choices");
	});

	it("defaults usage to zero when missing from response", async () => {
		const resp: OAIResponse = {
			id: "c1",
			choices: [{
				message: { role: "assistant", content: "ok" },
				finish_reason: "stop",
			}],
			model: "test",
		};
		setupMockFetch(mockFetchResponse(resp));
		const client = new OpenAIModelClient({ baseUrl: "http://localhost/v1", apiKey: "k" });
		const msg = await client.messages.create({
			model: "test",
			max_tokens: 100,
			messages: [{ role: "user", content: "hi" }],
		});
		expect(msg.usage.input_tokens).toBe(0);
		expect(msg.usage.output_tokens).toBe(0);
	});

	it("falls back to params.model when response model is empty", async () => {
		const resp: OAIResponse = {
			id: "c1",
			choices: [{
				message: { role: "assistant", content: "ok" },
				finish_reason: "stop",
			}],
			model: "",
		};
		setupMockFetch(mockFetchResponse(resp));
		const client = new OpenAIModelClient({ baseUrl: "http://localhost/v1", apiKey: "k" });
		const msg = await client.messages.create({
			model: "my-model",
			max_tokens: 100,
			messages: [{ role: "user", content: "hi" }],
		});
		expect(msg.model).toBe("my-model");
	});

	it("does not send tools when not provided", async () => {
		const resp: OAIResponse = {
			id: "c1",
			choices: [{
				message: { role: "assistant", content: "ok" },
				finish_reason: "stop",
			}],
			model: "test",
		};
		const mock = setupMockFetch(mockFetchResponse(resp));
		const client = new OpenAIModelClient({ baseUrl: "http://localhost/v1", apiKey: "k" });
		await client.messages.create({
			model: "test",
			max_tokens: 100,
			messages: [{ role: "user", content: "hi" }],
		});
		const body = JSON.parse(mock.mock.calls[0][1].body);
		expect(body.tools).toBeUndefined();
	});

	it("does not include stream_options for create (non-stream)", async () => {
		const resp: OAIResponse = {
			id: "c1",
			choices: [{
				message: { role: "assistant", content: "ok" },
				finish_reason: "stop",
			}],
			model: "test",
		};
		const mock = setupMockFetch(mockFetchResponse(resp));
		const client = new OpenAIModelClient({ baseUrl: "http://localhost/v1", apiKey: "k" });
		await client.messages.create({
			model: "test",
			max_tokens: 100,
			messages: [{ role: "user", content: "hi" }],
		});
		const body = JSON.parse(mock.mock.calls[0][1].body);
		expect(body.stream).toBe(false);
		expect(body.stream_options).toBeUndefined();
	});

	it("handles null content in response message", async () => {
		const resp: OAIResponse = {
			id: "c1",
			choices: [{
				message: { role: "assistant", content: null, tool_calls: [] },
				finish_reason: "stop",
			}],
			model: "test",
		};
		setupMockFetch(mockFetchResponse(resp));
		const client = new OpenAIModelClient({ baseUrl: "http://localhost/v1", apiKey: "k" });
		const msg = await client.messages.create({
			model: "test",
			max_tokens: 100,
			messages: [{ role: "user", content: "hi" }],
		});
		expect((msg.content[0] as Anthropic.TextBlock).text).toBe("");
	});

	it("handles create with tool_calls and no content", async () => {
		const resp: OAIResponse = {
			id: "c1",
			choices: [{
				message: {
					role: "assistant",
					content: null,
					tool_calls: [
						{ id: "c1", type: "function", function: { name: "search", arguments: '{"q":"test"}' } },
						{ id: "c2", type: "function", function: { name: "read", arguments: '{"p":"/x"}' } },
					],
				},
				finish_reason: "tool_calls",
			}],
			model: "test",
			usage: { prompt_tokens: 10, completion_tokens: 20 },
		};
		setupMockFetch(mockFetchResponse(resp));
		const client = new OpenAIModelClient({ baseUrl: "http://localhost/v1", apiKey: "k" });
		const msg = await client.messages.create({
			model: "test",
			max_tokens: 100,
			messages: [{ role: "user", content: "hi" }],
		});
		expect(msg.stop_reason).toBe("tool_use");
		expect(msg.content).toHaveLength(2);
		expect((msg.content[0] as Anthropic.ToolUseBlock).name).toBe("search");
		expect((msg.content[1] as Anthropic.ToolUseBlock).name).toBe("read");
	});

	it("propagates HTTP error details", async () => {
		setupMockFetch(mockFetchResponse({ error: { message: "rate limited" } }, 429));
		const client = new OpenAIModelClient({ baseUrl: "http://localhost/v1", apiKey: "k" });
		await expect(
			client.messages.create({
				model: "test",
				max_tokens: 100,
				messages: [{ role: "user", content: "hi" }],
			}),
		).rejects.toThrow("OpenAI API error 429");
	});
});
