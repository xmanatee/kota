import { describe, expect, it } from "vitest";
import {
	buildKotaModelResponse,
	toOpenAIMessages,
} from "./translations.js";

describe("OpenAI multimodal translations", () => {
	it("translates user image blocks into OpenAI multimodal content", () => {
		const result = toOpenAIMessages(undefined, [
			{
				role: "user",
				content: [
					{ type: "text", text: "inspect this" },
					{
						type: "image",
						source: {
							type: "base64",
							media_type: "image/png",
							data: "aW1hZ2U=",
						},
					},
				],
			},
		]);

		expect(result).toEqual([
			{
				role: "user",
				content: [
					{ type: "text", text: "inspect this" },
					{
						type: "image_url",
						image_url: { url: "data:image/png;base64,aW1hZ2U=" },
					},
				],
			},
		]);
	});

	it("builds response content with reasoning and cache usage metadata", () => {
		const msg = buildKotaModelResponse({
			thinking: "reasoning trace",
			text: "answer",
			toolCalls: [],
			stopReason: "end_turn",
			model: "test",
			usage: {
				input: 10,
				output: 4,
				cacheReadInput: 3,
				cacheCreationInput: 2,
			},
		});

		expect(msg.content[0]).toEqual({
			type: "thinking",
			thinking: "reasoning trace",
			signature: "",
		});
		expect(msg.content[1]).toEqual({ type: "text", text: "answer" });
		expect(msg.usage.cache_read_input_tokens).toBe(3);
		expect(msg.usage.cache_creation_input_tokens).toBe(2);
	});
});
