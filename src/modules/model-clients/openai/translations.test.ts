import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import type { KotaTool } from "#core/agent-harness/message-protocol.js";
import {
	buildAnthropicMessage,
	extractToolResultContent,
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
	it("returns empty prefix-only string for undefined content", () => {
		const block = {
			type: "tool_result" as const,
			tool_use_id: "t1",
		} as Anthropic.Messages.ToolResultBlockParam;
		expect(extractToolResultContent(block)).toBe("");
	});

	it("handles content array with text blocks", () => {
		const block: Anthropic.Messages.ToolResultBlockParam = {
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
		const block: Anthropic.Messages.ToolResultBlockParam = {
			type: "tool_result",
			tool_use_id: "t1",
			is_error: true,
			content: [{ type: "text", text: "something failed" }],
		};
		expect(extractToolResultContent(block)).toBe("[ERROR] something failed");
	});

	it("filters non-text blocks from content array", () => {
		const block: Anthropic.Messages.ToolResultBlockParam = {
			type: "tool_result",
			tool_use_id: "t1",
			content: [
				{ type: "image", source: { type: "base64", media_type: "image/png", data: "abc" } } as unknown as Anthropic.Messages.TextBlockParam,
				{ type: "text", text: "visible" },
			],
		};
		expect(extractToolResultContent(block)).toBe("visible");
	});

	it("returns prefix only for empty content array", () => {
		const block: Anthropic.Messages.ToolResultBlockParam = {
			type: "tool_result",
			tool_use_id: "t1",
			content: [],
		};
		expect(extractToolResultContent(block)).toBe("");
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
					{ type: "thinking", thinking: "deep thought" } as unknown as Anthropic.ContentBlockParam,
				],
			},
		]);
		expect(result).toEqual([{ role: "assistant", content: null }]);
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

describe("buildAnthropicMessage edge cases", () => {
	it("builds message with multiple tool calls", () => {
		const msg = buildAnthropicMessage({
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
		expect((msg.content[0] as Anthropic.ToolUseBlock).name).toBe("search");
		expect((msg.content[1] as Anthropic.ToolUseBlock).name).toBe("read");
	});

	it("includes text before tool calls when both present", () => {
		const msg = buildAnthropicMessage({
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
		const m1 = buildAnthropicMessage({
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
