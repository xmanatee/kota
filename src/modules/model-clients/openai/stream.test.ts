import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { OpenAIStream } from "./stream.js";

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

function okResponse(events: string[]): Response {
	return {
		ok: true,
		status: 200,
		body: sseChunks(events),
	} as unknown as Response;
}

describe("OpenAIStream", () => {
	it("throws when response body is null", async () => {
		const stream = new OpenAIStream(
			() => Promise.resolve({ ok: true, status: 200, body: null } as unknown as Response),
			"test",
		);
		await expect(stream.finalMessage()).rejects.toThrow("not readable");
	});

	it("handles empty choices array in chunk", async () => {
		const events = [
			JSON.stringify({ id: "c1", choices: [], model: "test" }),
			JSON.stringify({
				id: "c1",
				choices: [{ index: 0, delta: { content: "ok" }, finish_reason: "stop" }],
				model: "test",
			}),
			"[DONE]",
		];
		const stream = new OpenAIStream(() => Promise.resolve(okResponse(events)), "test");
		const msg = await stream.finalMessage();
		expect((msg.content[0] as Anthropic.TextBlock).text).toBe("ok");
	});

	it("accumulates multiple parallel tool calls", async () => {
		const events = [
			JSON.stringify({
				id: "c1",
				choices: [{
					index: 0,
					delta: {
						tool_calls: [
							{ index: 0, id: "call_a", type: "function", function: { name: "search", arguments: '{"q":' } },
							{ index: 1, id: "call_b", type: "function", function: { name: "read", arguments: '{"p":' } },
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
						tool_calls: [
							{ index: 0, function: { arguments: '"x"}' } },
							{ index: 1, function: { arguments: '"y"}' } },
						],
					},
					finish_reason: null,
				}],
				model: "test",
			}),
			JSON.stringify({
				id: "c1",
				choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
				model: "test",
			}),
			"[DONE]",
		];
		const stream = new OpenAIStream(() => Promise.resolve(okResponse(events)), "test");
		const msg = await stream.finalMessage();

		expect(msg.stop_reason).toBe("tool_use");
		expect(msg.content).toHaveLength(2);
		const tc0 = msg.content[0] as Anthropic.ToolUseBlock;
		const tc1 = msg.content[1] as Anthropic.ToolUseBlock;
		expect(tc0.name).toBe("search");
		expect(tc0.input).toEqual({ q: "x" });
		expect(tc1.name).toBe("read");
		expect(tc1.input).toEqual({ p: "y" });
	});

	it("handles SSE data split across multiple read() calls", async () => {
		const encoder = new TextEncoder();
		const chunk1 = 'data: {"id":"c1","choices":[{"index":0,"delta":{"content":"he';
		const chunk2 = 'llo"},"finish_reason":null}],"model":"test"}\n\ndata: [DONE]\n\n';

		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(encoder.encode(chunk1));
				controller.enqueue(encoder.encode(chunk2));
				controller.close();
			},
		});

		const stream = new OpenAIStream(
			() => Promise.resolve({ ok: true, status: 200, body } as unknown as Response),
			"test",
		);
		const msg = await stream.finalMessage();
		expect((msg.content[0] as Anthropic.TextBlock).text).toBe("hello");
	});

	it("handles interleaved text and tool calls", async () => {
		const events = [
			JSON.stringify({
				id: "c1",
				choices: [{ index: 0, delta: { content: "Let me " }, finish_reason: null }],
				model: "test",
			}),
			JSON.stringify({
				id: "c1",
				choices: [{
					index: 0,
					delta: { tool_calls: [{ index: 0, id: "c1", type: "function", function: { name: "search", arguments: '{"q":"x"}' } }] },
					finish_reason: null,
				}],
				model: "test",
			}),
			JSON.stringify({
				id: "c1",
				choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
				model: "test",
			}),
			"[DONE]",
		];
		const stream = new OpenAIStream(() => Promise.resolve(okResponse(events)), "test");
		const msg = await stream.finalMessage();

		expect(msg.content).toHaveLength(2);
		expect((msg.content[0] as Anthropic.TextBlock).text).toBe("Let me ");
		expect((msg.content[1] as Anthropic.ToolUseBlock).name).toBe("search");
	});

	it("picks up usage from mid-stream chunk", async () => {
		const events = [
			JSON.stringify({
				id: "c1",
				choices: [{ index: 0, delta: { content: "hi" }, finish_reason: null }],
				model: "test",
				usage: { prompt_tokens: 42, completion_tokens: 7 },
			}),
			JSON.stringify({
				id: "c1",
				choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
				model: "test",
			}),
			"[DONE]",
		];
		const stream = new OpenAIStream(() => Promise.resolve(okResponse(events)), "test");
		const msg = await stream.finalMessage();
		expect(msg.usage.input_tokens).toBe(42);
		expect(msg.usage.output_tokens).toBe(7);
	});

	it("assigns fallback id for tool call without id", async () => {
		const events = [
			JSON.stringify({
				id: "c1",
				choices: [{
					index: 0,
					delta: { tool_calls: [{ index: 0, function: { name: "f", arguments: "{}" } }] },
					finish_reason: null,
				}],
				model: "test",
			}),
			JSON.stringify({
				id: "c1",
				choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
				model: "test",
			}),
			"[DONE]",
		];
		const stream = new OpenAIStream(() => Promise.resolve(okResponse(events)), "test");
		const msg = await stream.finalMessage();
		const tc = msg.content[0] as Anthropic.ToolUseBlock;
		expect(tc.id).toBe("call_0");
	});

	it("uses fallback model when stream chunks have no model field", async () => {
		const events = [
			JSON.stringify({
				id: "c1",
				choices: [{ index: 0, delta: { content: "hi" }, finish_reason: "stop" }],
				model: "",
			}),
			"[DONE]",
		];
		const stream = new OpenAIStream(() => Promise.resolve(okResponse(events)), "my-fallback");
		const msg = await stream.finalMessage();
		expect(msg.model).toBe("my-fallback");
	});

	it("registers multiple listeners for same event", async () => {
		const events = [
			JSON.stringify({
				id: "c1",
				choices: [{ index: 0, delta: { content: "hi" }, finish_reason: "stop" }],
				model: "test",
			}),
			"[DONE]",
		];
		const stream = new OpenAIStream(() => Promise.resolve(okResponse(events)), "test");
		const chunks1: string[] = [];
		const chunks2: string[] = [];
		stream.on("text", (d) => chunks1.push(d));
		stream.on("text", (d) => chunks2.push(d));
		await stream.finalMessage();
		expect(chunks1).toEqual(["hi"]);
		expect(chunks2).toEqual(["hi"]);
	});

	it("ignores non-SSE lines in stream", async () => {
		const encoder = new TextEncoder();
		const raw = ": comment\nretry: 5000\ndata: " +
			JSON.stringify({ id: "c1", choices: [{ index: 0, delta: { content: "ok" }, finish_reason: "stop" }], model: "t" }) +
			"\n\ndata: [DONE]\n\n";
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(encoder.encode(raw));
				controller.close();
			},
		});
		const stream = new OpenAIStream(
			() => Promise.resolve({ ok: true, status: 200, body } as unknown as Response),
			"test",
		);
		const msg = await stream.finalMessage();
		expect((msg.content[0] as Anthropic.TextBlock).text).toBe("ok");
	});
});
