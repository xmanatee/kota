import { describe, expect, it, vi } from "vitest";
import { OpenAIModelClient } from "./client.js";
import type { OAIResponse } from "./types.js";

function mockFetchResponse(body: unknown): Response {
	return {
		ok: true,
		status: 200,
		headers: new Headers(),
		text: () => Promise.resolve(JSON.stringify(body)),
		json: () => Promise.resolve(body),
		body: null,
	} as unknown as Response;
}

describe("OpenAIModelClient create response parsing", () => {
	it("parses non-stream reasoning metadata and cache usage", async () => {
		const resp: OAIResponse = {
			id: "c1",
			choices: [{
				message: {
					role: "assistant",
					content: "final",
					reasoning_content: "private reasoning",
				},
				finish_reason: "stop",
			}],
			model: "test",
			usage: {
				prompt_tokens: 12,
				completion_tokens: 5,
				prompt_tokens_details: {
					cached_tokens: 4,
					cache_creation_tokens: 2,
				},
			},
		};
		const originalFetch = globalThis.fetch;
		globalThis.fetch = vi.fn().mockResolvedValue(mockFetchResponse(resp));
		try {
			const client = new OpenAIModelClient({
				baseUrl: "http://localhost/v1",
				apiKey: "k",
				presetName: "test",
			});
			const msg = await client.messages.create({
				model: "test",
				max_tokens: 100,
				messages: [{ role: "user", content: "hi" }],
			});
			expect(msg.content[0]).toEqual({
				type: "thinking",
				thinking: "private reasoning",
				signature: "",
			});
			expect(msg.content[1]).toEqual({ type: "text", text: "final" });
			expect(msg.usage.cache_read_input_tokens).toBe(4);
			expect(msg.usage.cache_creation_input_tokens).toBe(2);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});
