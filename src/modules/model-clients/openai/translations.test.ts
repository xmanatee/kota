import { describe, expect, it } from "vitest";
import type {
	KotaImageBlock,
	KotaMessage,
	KotaTextBlock,
	KotaTool,
	KotaToolResultBlock,
	KotaToolUseBlock,
} from "#core/agent-harness/message-protocol.js";
import {
	buildKotaModelResponse,
	extractToolResultContent,
	kotaMessageToOpenAiMessage,
	mapFinishReason,
	safeJsonParse,
	systemToText,
	toOpenAIMessages,
	toOpenAITools,
} from "./translations.js";

describe("safeJsonParse", () => {
	it("returns empty object for empty string", () => {
		expect(safeJsonParse("")).toEqual({});
	});

	it("parses valid JSON", () => {
		expect(safeJsonParse('{"a":1}')).toEqual({ a: 1 });
	});

	it("wraps malformed JSON in _raw", () => {
		expect(safeJsonParse("{broken")).toEqual({ _raw: "{broken" });
	});

	it("parses JSON array", () => {
		expect(safeJsonParse("[1,2,3]")).toEqual([1, 2, 3]);
	});

	it("parses JSON string literal", () => {
		expect(safeJsonParse('"hello"')).toBe("hello");
	});
});

describe("extractToolResultContent", () => {
	it("returns empty prefix-only string for empty-string content", () => {
		const block: KotaToolResultBlock = {
			type: "tool_result",
			tool_use_id: "t1",
			content: "",
		};
		expect(extractToolResultContent(block)).toBe("");
	});

	it("handles content array with text blocks", () => {
		const block: KotaToolResultBlock = {
			type: "tool_result",
			tool_use_id: "t1",
			content: [
				{ type: "text", text: "line1" },
				{ type: "text", text: "line2" },
			],
		};
		expect(extractToolResultContent(block)).toBe("line1\nline2");
	});

	it("handles content array with is_error", () => {
		const block: KotaToolResultBlock = {
			type: "tool_result",
			tool_use_id: "t1",
			is_error: true,
			content: [{ type: "text", text: "something failed" }],
		};
		expect(extractToolResultContent(block)).toBe("[ERROR] something failed");
	});

	it("rejects image blocks it cannot translate in content arrays", () => {
		const block: KotaToolResultBlock = {
			type: "tool_result",
			tool_use_id: "t1",
			content: [
				{
					type: "image",
					source: { type: "base64", media_type: "image/png", data: "abc" },
				},
				{ type: "text", text: "visible" },
			],
		};
		expect(() => extractToolResultContent(block)).toThrow(
			/content\[0\]\.image:image\/png/,
		);
	});

	it("returns prefix only for empty content array", () => {
		const block: KotaToolResultBlock = {
			type: "tool_result",
			tool_use_id: "t1",
			content: [],
		};
		expect(extractToolResultContent(block)).toBe("");
	});

	it("rejects enriched tool_result fields it cannot translate", () => {
		const block: KotaToolResultBlock = {
			type: "tool_result",
			tool_use_id: "t1",
			content: [{ type: "text", text: "visible", _meta: { blockCache: "b1" } }],
			structuredContent: { answer: 42 },
			_meta: { resultCache: "r1" },
		};
		expect(() => extractToolResultContent(block)).toThrow(
			/enriched tool_result fields: structuredContent, _meta, content\[0\]\._meta/,
		);
	});

	it("rejects MCP-only tool_result content explicitly", () => {
		const block: KotaToolResultBlock = {
			type: "tool_result",
			tool_use_id: "t1",
			content: [{
				type: "mcp_content",
				content: { type: "audio", data: "abc", mimeType: "audio/wav" },
			}],
		};
		expect(() => extractToolResultContent(block)).toThrow(
			/content\[0\]\.mcp_content:audio/,
		);
	});
});

describe("toOpenAIMessages edge cases", () => {
	it("returns empty array for empty messages and no system", () => {
		expect(toOpenAIMessages(undefined, [])).toEqual([]);
	});

	it("returns only system message when messages empty", () => {
		const result = toOpenAIMessages("sys", []);
		expect(result).toEqual([{ role: "system", content: "sys" }]);
	});

	it("handles multiple tool_results in one user message", () => {
		const result = toOpenAIMessages(undefined, [
			{
				role: "user",
				content: [
					{ type: "tool_result", tool_use_id: "t1", content: "r1" },
					{ type: "tool_result", tool_use_id: "t2", content: "r2" },
				],
			},
		]);
		expect(result).toEqual([
			{ role: "tool", tool_call_id: "t1", content: "r1" },
			{ role: "tool", tool_call_id: "t2", content: "r2" },
		]);
	});

	it("handles text after tool_result in user message", () => {
		const result = toOpenAIMessages(undefined, [
			{
				role: "user",
				content: [
					{ type: "tool_result", tool_use_id: "t1", content: "r1" },
					{ type: "text", text: "followup" },
				],
			},
		]);
		expect(result).toEqual([
			{ role: "tool", tool_call_id: "t1", content: "r1" },
			{ role: "user", content: "followup" },
		]);
	});

	it("handles assistant with only thinking blocks", () => {
		const result = toOpenAIMessages(undefined, [
			{
				role: "assistant",
				content: [
					{ type: "thinking", thinking: "deep thought", signature: "" },
				],
			},
		]);
		expect(result).toEqual([{ role: "assistant", content: null }]);
	});
});

describe("kotaMessageToOpenAiMessage round-trip coverage", () => {
	it("translates a user text message into one OpenAI entry", () => {
		const msg: KotaMessage = { role: "user", content: "hello" };
		expect(kotaMessageToOpenAiMessage(msg)).toEqual([
			{ role: "user", content: "hello" },
		]);
	});

	it("translates an assistant text block into one OpenAI entry", () => {
		const textBlock: KotaTextBlock = { type: "text", text: "response" };
		const msg: KotaMessage = { role: "assistant", content: [textBlock] };
		expect(kotaMessageToOpenAiMessage(msg)).toEqual([
			{ role: "assistant", content: "response" },
		]);
	});

	it("translates an assistant tool_use block into a tool_calls entry", () => {
		const useBlock: KotaToolUseBlock = {
			type: "tool_use",
			id: "t1",
			name: "lookup",
			input: { key: "foo" },
		};
		const msg: KotaMessage = { role: "assistant", content: [useBlock] };
		expect(kotaMessageToOpenAiMessage(msg)).toEqual([
			{
				role: "assistant",
				content: null,
				tool_calls: [
					{
						id: "t1",
						type: "function",
						function: { name: "lookup", arguments: JSON.stringify({ key: "foo" }) },
					},
				],
			},
		]);
	});

	it("translates a tool_result with string content into a tool entry", () => {
		const resultBlock: KotaToolResultBlock = {
			type: "tool_result",
			tool_use_id: "t1",
			content: "result body",
		};
		const msg: KotaMessage = { role: "user", content: [resultBlock] };
		expect(kotaMessageToOpenAiMessage(msg)).toEqual([
			{ role: "tool", tool_call_id: "t1", content: "result body" },
		]);
	});

	it("rejects a tool_result with mixed text and image block content", () => {
		const textA: KotaTextBlock = { type: "text", text: "first" };
		const textB: KotaTextBlock = { type: "text", text: "second" };
		const image: KotaImageBlock = {
			type: "image",
			source: { type: "base64", media_type: "image/png", data: "abc" },
		};
		const resultBlock: KotaToolResultBlock = {
			type: "tool_result",
			tool_use_id: "t1",
			content: [textA, image, textB],
		};
		const msg: KotaMessage = { role: "user", content: [resultBlock] };
		expect(() => kotaMessageToOpenAiMessage(msg)).toThrow(
			/content\[1\]\.image:image\/png/,
		);
	});

	it("rejects a tool_result with image-only block content", () => {
		const image: KotaImageBlock = {
			type: "image",
			source: { type: "base64", media_type: "image/png", data: "abc" },
		};
		const resultBlock: KotaToolResultBlock = {
			type: "tool_result",
			tool_use_id: "t1",
			content: [image],
		};
		const msg: KotaMessage = { role: "user", content: [resultBlock] };
		expect(() => kotaMessageToOpenAiMessage(msg)).toThrow(
			/content\[0\]\.image:image\/png/,
		);
	});
});

describe("toOpenAITools edge cases", () => {
	it("returns empty array for empty tools", () => {
		expect(toOpenAITools([])).toEqual([]);
	});

	it("handles complex nested schema", () => {
		const tools: KotaTool[] = [
			{
				name: "complex",
				description: "A complex tool",
				input_schema: {
					type: "object" as const,
					properties: {
						nested: {
							type: "object",
							properties: { deep: { type: "string" } },
						},
					},
					required: ["nested"],
				},
			},
		];
		const result = toOpenAITools(tools);
		expect(result[0].function.parameters.required).toEqual(["nested"]);
	});
});

describe("mapFinishReason edge cases", () => {
	it("maps content_filter to end_turn (no special mapping)", () => {
		expect(mapFinishReason("content_filter")).toBe("end_turn");
	});
});

describe("buildKotaModelResponse edge cases", () => {
	it("builds response with multiple tool calls", () => {
		const msg = buildKotaModelResponse({
			text: "",
			toolCalls: [
				{ id: "c1", name: "search", input: { q: "a" } },
				{ id: "c2", name: "read", input: { path: "/x" } },
			],
			stopReason: "tool_use",
			model: "test",
			usage: { input: 0, output: 0 },
		});
		expect(msg.content).toHaveLength(2);
		expect(msg.content[0].type).toBe("tool_use");
		expect(msg.content[1].type).toBe("tool_use");
		expect((msg.content[0] as KotaToolUseBlock).name).toBe("search");
		expect((msg.content[1] as KotaToolUseBlock).name).toBe("read");
	});

	it("includes text before tool calls when both present", () => {
		const msg = buildKotaModelResponse({
			text: "Analyzing...",
			toolCalls: [{ id: "c1", name: "analyze", input: {} }],
			stopReason: "tool_use",
			model: "gpt-4o",
			usage: { input: 100, output: 50 },
		});
		expect(msg.content).toHaveLength(2);
		expect(msg.content[0].type).toBe("text");
		expect(msg.content[1].type).toBe("tool_use");
		expect(msg.usage.input_tokens).toBe(100);
		expect(msg.usage.output_tokens).toBe(50);
	});

	it("generates unique-ish message ids", () => {
		const m1 = buildKotaModelResponse({
			text: "a", toolCalls: [], stopReason: "end_turn",
			model: "t", usage: { input: 0, output: 0 },
		});
		expect(m1.id).toMatch(/^msg_oai_\d+$/);
	});
});

describe("systemToText edge cases", () => {
	it("returns undefined for empty string", () => {
		expect(systemToText("")).toBeUndefined();
	});

	it("handles single-element TextBlockParam array", () => {
		expect(systemToText([{ type: "text" as const, text: "only" }])).toBe("only");
	});
});
