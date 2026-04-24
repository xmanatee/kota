import type Anthropic from "@anthropic-ai/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
	KotaImageBlock,
	KotaMessage,
	KotaTextBlock,
	KotaThinkingBlock,
	KotaToolResultBlock,
	KotaToolUseBlock,
} from "#core/agent-harness/message-protocol.js";
import {
	AnthropicModelClient,
	kotaBlockToAnthropicBlock,
	kotaMessageToAnthropicMessage,
	kotaTextBlockToAnthropic,
} from "./anthropic.js";

const sdkStreamMock = vi.fn();

vi.mock("@anthropic-ai/sdk", () => {
	const ctor = vi.fn(function (this: Record<string, unknown>) {
		this.messages = {
			stream: (...args: unknown[]) => sdkStreamMock(...args),
			create: vi.fn(),
		};
	});
	return { default: ctor };
});

afterEach(() => {
	sdkStreamMock.mockReset();
});

describe("AnthropicModelClient — effort passthrough", () => {
	it("translates effort to a thinking config and strips the effort field before handing to the SDK", () => {
		sdkStreamMock.mockReturnValue({});
		const client = new AnthropicModelClient();
		client.messages.stream({
			model: "claude-sonnet-4-6",
			max_tokens: 100,
			messages: [{ role: "user", content: "hi" }],
			effort: "xhigh",
		});
		const sdkParams = sdkStreamMock.mock.calls[0][0] as {
			effort?: unknown;
			thinking?: { type: string; budget_tokens: number };
		};
		expect(sdkParams.effort).toBeUndefined();
		expect(sdkParams.thinking).toMatchObject({
			type: "enabled",
			budget_tokens: expect.any(Number),
		});
	});

	it("leaves an explicit thinking config intact and strips effort", () => {
		sdkStreamMock.mockReturnValue({});
		const client = new AnthropicModelClient();
		client.messages.stream({
			model: "claude-sonnet-4-6",
			max_tokens: 100,
			messages: [{ role: "user", content: "hi" }],
			effort: "high",
			thinking: { type: "enabled", budget_tokens: 999 },
		});
		const sdkParams = sdkStreamMock.mock.calls[0][0] as {
			effort?: unknown;
			thinking: Anthropic.Messages.ThinkingConfigParam;
		};
		expect(sdkParams.effort).toBeUndefined();
		expect(sdkParams.thinking).toEqual({ type: "enabled", budget_tokens: 999 });
	});

	it("forwards a plain request without effort or thinking untouched", () => {
		sdkStreamMock.mockReturnValue({});
		const client = new AnthropicModelClient();
		client.messages.stream({
			model: "claude-sonnet-4-6",
			max_tokens: 100,
			messages: [{ role: "user", content: "hi" }],
		});
		const sdkParams = sdkStreamMock.mock.calls[0][0] as {
			effort?: unknown;
			thinking?: unknown;
		};
		expect(sdkParams.effort).toBeUndefined();
		expect(sdkParams.thinking).toBeUndefined();
	});
});

describe("kotaMessageToAnthropicMessage — block coverage", () => {
	it("passes string content through unchanged", () => {
		const msg: KotaMessage = { role: "user", content: "hello" };
		expect(kotaMessageToAnthropicMessage(msg)).toEqual({
			role: "user",
			content: "hello",
		});
	});

	it("translates text block with cache_control field-for-field", () => {
		const textBlock: KotaTextBlock = {
			type: "text",
			text: "body",
			cache_control: { type: "ephemeral" },
		};
		expect(kotaTextBlockToAnthropic(textBlock)).toEqual({
			type: "text",
			text: "body",
			cache_control: { type: "ephemeral" },
		});
	});

	it("translates tool_use block field-for-field", () => {
		const block: KotaToolUseBlock = {
			type: "tool_use",
			id: "t1",
			name: "lookup",
			input: { key: "value" },
		};
		expect(kotaBlockToAnthropicBlock(block)).toEqual({
			type: "tool_use",
			id: "t1",
			name: "lookup",
			input: { key: "value" },
		});
	});

	it("translates tool_result block with string content field-for-field", () => {
		const block: KotaToolResultBlock = {
			type: "tool_result",
			tool_use_id: "t1",
			content: "ok",
			is_error: false,
		};
		expect(kotaBlockToAnthropicBlock(block)).toEqual({
			type: "tool_result",
			tool_use_id: "t1",
			content: "ok",
			is_error: false,
		});
	});

	it("translates tool_result block with mixed text + image content field-for-field", () => {
		const block: KotaToolResultBlock = {
			type: "tool_result",
			tool_use_id: "t1",
			content: [
				{ type: "text", text: "summary" },
				{
					type: "image",
					source: { type: "base64", media_type: "image/png", data: "abc" },
				},
			],
		};
		const translated = kotaBlockToAnthropicBlock(
			block,
		) as Anthropic.Messages.ToolResultBlockParam;
		expect(translated.type).toBe("tool_result");
		expect(translated.content).toEqual([
			{ type: "text", text: "summary" },
			{
				type: "image",
				source: { type: "base64", media_type: "image/png", data: "abc" },
			},
		]);
	});

	it("translates image block with narrowed media_type", () => {
		const block: KotaImageBlock = {
			type: "image",
			source: { type: "base64", media_type: "image/png", data: "abc" },
		};
		expect(kotaBlockToAnthropicBlock(block)).toEqual({
			type: "image",
			source: { type: "base64", media_type: "image/png", data: "abc" },
		});
	});

	it("translates thinking block field-for-field", () => {
		const block: KotaThinkingBlock = {
			type: "thinking",
			thinking: "deep thought",
			signature: "sig",
		};
		expect(kotaBlockToAnthropicBlock(block)).toEqual({
			type: "thinking",
			thinking: "deep thought",
			signature: "sig",
		});
	});

	it("round-trips a multi-block assistant message", () => {
		const msg: KotaMessage = {
			role: "assistant",
			content: [
				{ type: "text", text: "I will lookup" },
				{
					type: "tool_use",
					id: "t1",
					name: "lookup",
					input: { key: "foo" },
				},
			],
		};
		expect(kotaMessageToAnthropicMessage(msg)).toEqual({
			role: "assistant",
			content: [
				{ type: "text", text: "I will lookup" },
				{ type: "tool_use", id: "t1", name: "lookup", input: { key: "foo" } },
			],
		});
	});
});
