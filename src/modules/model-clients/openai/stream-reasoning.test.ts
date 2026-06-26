import { describe, expect, it, vi } from "vitest";
import type {
	KotaMessage,
	KotaToolUseBlock,
} from "#core/agent-harness/message-protocol.js";
import { compactMessages } from "#core/loop/compaction.js";
import type { MessageCreateParams, ModelClient } from "#core/model/model-client.js";
import { OpenAIStream } from "./stream.js";

function okResponse(events: string[]): Response {
	const encoder = new TextEncoder();
	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(
				encoder.encode(events.map((event) => `data: ${event}\n\n`).join("")),
			);
			controller.close();
		},
	});
	return { ok: true, status: 200, body } as unknown as Response;
}

describe("OpenAIStream reasoning parity", () => {
	it("handles late tool-call names and drops reasoning before compaction prompts", async () => {
		const privateReasoningA = "STREAM-PRIVATE-REASONING-A";
		const privateReasoningB = "STREAM-PRIVATE-REASONING-B";
		const events = [
			JSON.stringify({
				id: "c1",
				choices: [{
					index: 0,
					delta: {
						reasoning: privateReasoningA,
						tool_calls: [
							{ index: 0, id: "call_1", type: "function", function: { arguments: '{"q":' } },
						],
					},
					finish_reason: null,
				}],
				model: "test",
			}),
			JSON.stringify({
				id: "c1",
				choices: [{
					index: 0,
					delta: {
						reasoning_content: privateReasoningB,
						tool_calls: [
							{ index: 0, function: { name: "search", arguments: '"x"}' } },
						],
					},
					finish_reason: null,
				}],
				model: "test",
				usage: {
					prompt_tokens: 9,
					completion_tokens: 3,
					prompt_tokens_details: { cached_tokens: 2 },
				},
			}),
			JSON.stringify({
				id: "c1",
				choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
				model: "test",
			}),
			"[DONE]",
		];
		const stream = new OpenAIStream(() => Promise.resolve(okResponse(events)), "test");
		const thinkingDeltas: string[] = [];
		stream.on("thinking", (delta) => thinkingDeltas.push(delta));

		const msg = await stream.finalMessage();

		expect(thinkingDeltas).toEqual([]);
		expect(JSON.stringify(msg.content)).not.toContain(privateReasoningA);
		expect(JSON.stringify(msg.content)).not.toContain(privateReasoningB);
		const tc = msg.content[0] as KotaToolUseBlock;
		expect(tc.name).toBe("search");
		expect(tc.input).toEqual({ q: "x" });
		expect(msg.usage.input_tokens).toBe(9);
		expect(msg.usage.output_tokens).toBe(3);
		expect(msg.usage.cache_read_input_tokens).toBe(2);

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
		expect(prompt).not.toContain(privateReasoningA);
		expect(prompt).not.toContain(privateReasoningB);
	});
});
