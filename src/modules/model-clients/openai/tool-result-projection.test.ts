import { describe, expect, it } from "vitest";
import type { KotaToolResultBlock } from "#core/agent-harness/message-protocol.js";
import { extractToolResultContent } from "./translations.js";

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

	it("projects image blocks into bounded text for tool-role content", () => {
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
		expect(extractToolResultContent(block)).toBe(
			"[image omitted: image/png, base64 bytes=3]\nvisible",
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

	it("projects enriched tool_result fields without mutating the rich block", () => {
		const block: KotaToolResultBlock = {
			type: "tool_result",
			tool_use_id: "t1",
			content: [
				{
					type: "text",
					text: "visible",
					annotations: { audience: ["assistant"], priority: 0.5 },
					_meta: { blockCache: "b1" },
				},
			],
			structuredContent: { answer: 42 },
			_meta: { resultCache: "r1" },
		};
		const original = structuredClone(block);

		const projection = extractToolResultContent(block);

		expect(block).toEqual(original);
		expect(projection).toContain("visible");
		expect(projection).toContain('"answer": 42');
		expect(projection).toContain('"audience": [');
		expect(projection).toContain("[content _meta keys: blockCache]");
		expect(projection).toContain("[tool result _meta keys: resultCache]");
		expect(projection).not.toContain("b1");
		expect(projection).not.toContain("r1");
	});

	it("projects MCP-only tool_result content explicitly", () => {
		const block: KotaToolResultBlock = {
			type: "tool_result",
			tool_use_id: "t1",
			content: [
				{
					type: "mcp_content",
					content: {
						type: "resource",
						resource: {
							uri: "file:///context.md",
							mimeType: "text/markdown",
							text: "remote context",
							_meta: { traceId: "hidden-resource-meta" },
						},
						_meta: { providerTrace: "hidden-content-meta" },
					},
				},
				{
					type: "mcp_content",
					content: {
						type: "resource",
						resource: {
							uri: "file:///image.bin",
							mimeType: "application/octet-stream",
							blob: "abc123",
						},
					},
				},
				{
					type: "mcp_content",
					content: { type: "audio", data: "abc", mimeType: "audio/wav" },
				},
			],
		};

		const projection = extractToolResultContent(block);

		expect(projection).toContain("[MCP resource: file:///context.md text/markdown]");
		expect(projection).toContain("remote context");
		expect(projection).toContain("[content _meta keys: providerTrace]");
		expect(projection).toContain("[resource _meta keys: traceId]");
		expect(projection).toContain(
			"[MCP resource blob omitted: file:///image.bin application/octet-stream, base64 bytes=6]",
		);
		expect(projection).toContain("[MCP audio omitted: audio/wav, base64 bytes=3]");
		expect(projection).not.toContain("hidden-resource-meta");
		expect(projection).not.toContain("hidden-content-meta");
	});

	it("bounds oversized tool-result projections", () => {
		const block: KotaToolResultBlock = {
			type: "tool_result",
			tool_use_id: "t1",
			content: "x".repeat(25_000),
		};
		const projection = extractToolResultContent(block);
		expect(projection.length).toBeLessThan(20_100);
		expect(projection).toContain("chars truncated from tool result projection");
	});
});
