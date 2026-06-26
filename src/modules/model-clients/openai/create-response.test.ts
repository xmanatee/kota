import { describe, expect, it, vi } from "vitest";
import type { KotaMessage } from "#core/agent-harness/message-protocol.js";
import { compactMessages } from "#core/loop/compaction.js";
import type { MessageCreateParams, ModelClient } from "#core/model/model-client.js";
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
	it("drops non-stream reasoning metadata before compaction prompts", async () => {
		const privateReasoning = "CREATE-PRIVATE-REASONING";
		const resp: OAIResponse = {
			id: "c1",
			choices: [{
				message: {
					role: "assistant",
					content: "final",
					reasoning_content: privateReasoning,
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
			expect(msg.content).toEqual([{ type: "text", text: "final" }]);
			expect(msg.usage.cache_read_input_tokens).toBe(4);
			expect(msg.usage.cache_creation_input_tokens).toBe(2);

			const create = vi.fn().mockResolvedValue({
				content: [{ type: "text", text: "summary" }],
			});
			const compactionClient = {
				messages: { create },
			} as unknown as ModelClient;
			const messages: KotaMessage[] = [
				{ role: "user", content: "continue" },
				msg,
			];

			await compactMessages(compactionClient, "test", messages, 1);
			const params = create.mock.calls[0]?.[0] as MessageCreateParams | undefined;
			const prompt = params?.messages[0]?.content;
			expect(typeof prompt).toBe("string");
			expect(prompt).not.toContain(privateReasoning);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});
