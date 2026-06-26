import { describe, expect, it } from "vitest";
import type { KotaToolUseBlock } from "#core/agent-harness/message-protocol.js";
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
	it("handles late tool-call names, reasoning deltas, and usage chunks", async () => {
		const events = [
			JSON.stringify({
				id: "c1",
				choices: [{
					index: 0,
					delta: {
						reasoning: "think ",
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
						reasoning_content: "more",
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

		expect(thinkingDeltas).toEqual(["think ", "more"]);
		expect(msg.content[0]).toEqual({
			type: "thinking",
			thinking: "think more",
			signature: "",
		});
		const tc = msg.content[1] as KotaToolUseBlock;
		expect(tc.name).toBe("search");
		expect(tc.input).toEqual({ q: "x" });
		expect(msg.usage.input_tokens).toBe(9);
		expect(msg.usage.output_tokens).toBe(3);
		expect(msg.usage.cache_read_input_tokens).toBe(2);
	});
});
