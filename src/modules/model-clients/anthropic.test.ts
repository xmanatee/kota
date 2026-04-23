import type Anthropic from "@anthropic-ai/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnthropicModelClient } from "./anthropic.js";

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
