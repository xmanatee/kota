import { describe, expect, it } from "vitest";
import type { KotaTool } from "#core/agent-harness/message-protocol.js";
import type { MessageStreamParams } from "#core/model/model-client.js";
import { openRouterCapabilitiesToOpenAIModelCapabilities } from "../openrouter-capabilities.js";
import { getOpenRouterModelCapabilities } from "../openrouter-catalog.js";
import { openaiReasoningEffortTranslator } from "../reasoning.js";
import { buildOpenAIRequestBody } from "./request-body.js";
import type { OAIRequestOptions } from "./types.js";

const lookupTool: KotaTool = {
	name: "lookup",
	description: "Lookup a fact",
	input_schema: {
		type: "object",
		properties: { q: { type: "string" } },
		required: ["q"],
	},
};

const lookupToolWire = [{
	type: "function",
	function: {
		name: "lookup",
		description: "Lookup a fact",
		parameters: lookupTool.input_schema,
	},
}];

function baseParams(
	model: string,
	maxTokens: number,
	extra: Partial<MessageStreamParams> = {},
): MessageStreamParams {
	return {
		model,
		max_tokens: maxTokens,
		messages: [{ role: "user", content: "hi" }],
		...extra,
	};
}

function openRouterBody(
	model: string,
	maxTokens: number,
	extra: Partial<MessageStreamParams> = {},
	requestOptions: OAIRequestOptions = {},
) {
	return buildOpenAIRequestBody(baseParams(model, maxTokens, extra), true, {
		presetName: "openrouter",
		modelCapabilities: openRouterCapabilitiesToOpenAIModelCapabilities(
			getOpenRouterModelCapabilities(model),
		),
		requestOptions,
	});
}

describe("OpenAI request body model capabilities", () => {
	it("uses the Chat Completions reasoning field for direct GPT-5.6 requests", () => {
		const body = buildOpenAIRequestBody(
			baseParams("gpt-5.6-sol", 128_000, { effort: "xhigh" }),
			true,
			{
				presetName: "openai",
				effortTranslator: openaiReasoningEffortTranslator,
				requestOptions: {},
			},
		);

		expect(body.max_completion_tokens).toBe(128_000);
		expect(body.max_tokens).toBeUndefined();
		expect(body.reasoning_effort).toBe("xhigh");
		expect(body.reasoning).toBeUndefined();
	});

	it("rejects GPT-5.6 function tools on direct Chat Completions", () => {
		expect(() =>
			buildOpenAIRequestBody(
				baseParams("gpt-5.6-terra", 128_000, {
					tools: [lookupTool],
					effort: "xhigh",
				}),
				true,
				{
					presetName: "openai",
					effortTranslator: openaiReasoningEffortTranslator,
					requestOptions: {},
				},
			),
		).toThrow(/GPT-5\.6.*function tools.*Responses API/);
	});

	it("builds an exact GLM 5.2 request with reasoning and routing", () => {
		const responseFormat = {
			type: "json_schema" as const,
			json_schema: {
				name: "answer",
				strict: true,
				schema: { type: "object", properties: {} },
			},
		};
		expect(
			openRouterBody(
				"z-ai/glm-5.2",
				32_768,
				{ tools: [lookupTool], effort: "xhigh" },
				{
					responseFormat,
					structuredOutputs: true,
					provider: { order: ["z-ai"], allow_fallbacks: false },
				},
			),
		).toEqual({
			model: "z-ai/glm-5.2",
			max_tokens: 32_768,
			messages: [{ role: "user", content: "hi" }],
			stream: true,
			tools: lookupToolWire,
			tool_choice: "auto",
			response_format: responseFormat,
			structured_outputs: true,
			provider: { order: ["z-ai"], allow_fallbacks: false },
			stream_options: { include_usage: true },
			include_reasoning: true,
			reasoning: { effort: "xhigh" },
		});
	});

	it("builds a Kimi K2.7 Code request with mandatory reasoning", () => {
		expect(
			openRouterBody("moonshotai/kimi-k2.7-code", 16_384, {
				tools: [lookupTool],
			}),
		).toEqual({
			model: "moonshotai/kimi-k2.7-code",
			max_tokens: 16_384,
			messages: [{ role: "user", content: "hi" }],
			stream: true,
			tools: lookupToolWire,
			tool_choice: "auto",
			parallel_tool_calls: true,
			stream_options: { include_usage: true },
			include_reasoning: true,
		});
	});

	it.each([
		["deepseek/deepseek-v4-pro", 384_000, "xhigh"],
		["deepseek/deepseek-v4-flash", 65_536, "high"],
	] as const)("builds exact %s output and reasoning limits", (model, maxTokens, effort) => {
		expect(openRouterBody(model, maxTokens, { tools: [lookupTool], effort })).toEqual({
			model,
			max_tokens: maxTokens,
			messages: [{ role: "user", content: "hi" }],
			stream: true,
			tools: lookupToolWire,
			tool_choice: "auto",
			stream_options: { include_usage: true },
			include_reasoning: true,
			reasoning: { effort },
		});
	});

	it("builds a Qwen 3.7 request with image input and JSON format", () => {
		const messages: MessageStreamParams["messages"] = [{
			role: "user",
			content: [
				{ type: "text", text: "inspect" },
				{
					type: "image",
					source: { type: "base64", media_type: "image/png", data: "aW1hZ2U=" },
				},
			],
		}];

		expect(
			openRouterBody(
				"qwen/qwen3.7-plus",
				65_536,
				{ messages, tools: [lookupTool] },
				{ responseFormat: { type: "json_object" }, structuredOutputs: true },
			),
		).toEqual({
			model: "qwen/qwen3.7-plus",
			max_tokens: 65_536,
			messages: [{
				role: "user",
				content: [
					{ type: "text", text: "inspect" },
					{
						type: "image_url",
						image_url: { url: "data:image/png;base64,aW1hZ2U=" },
					},
				],
			}],
			stream: true,
			tools: lookupToolWire,
			tool_choice: "auto",
			response_format: { type: "json_object" },
			structured_outputs: true,
			stream_options: { include_usage: true },
			include_reasoning: true,
		});
	});

	it("keeps local no-metadata routes generic", () => {
		const body = buildOpenAIRequestBody(
			baseParams("llama3", 4096, { tools: [lookupTool] }),
			true,
			{ presetName: "ollama", requestOptions: {} },
		);

		expect(body).toEqual({
			model: "llama3",
			max_tokens: 4096,
			messages: [{ role: "user", content: "hi" }],
			stream: true,
			tools: lookupToolWire,
			stream_options: { include_usage: true },
		});
	});

	it("rejects unsupported model-specific reasoning and output limits", () => {
		expect(() =>
			openRouterBody("z-ai/glm-5.2", 32_768, { effort: "low" }),
		).toThrow(/z-ai\/glm-5.2.*low.*xhigh, high/s);
		expect(() =>
			openRouterBody("z-ai/glm-5.2", 32_768, { effort: "max" }),
		).toThrow(/z-ai\/glm-5.2.*max.*xhigh, high/s);
		expect(() =>
			openRouterBody("moonshotai/kimi-k2.7-code", 16_384, { effort: "high" }),
		).toThrow(/moonshotai\/kimi-k2.7-code.*effort "high".*none declared/s);
		expect(() =>
			openRouterBody("qwen/qwen3.7-plus", 65_536, { effort: "high" }),
		).toThrow(/qwen\/qwen3.7-plus.*effort "high".*none declared/s);
		expect(() =>
			openRouterBody("z-ai/glm-5.2", 32_769, { effort: "high" }),
		).toThrow(/at most 32768 output tokens/);
	});
});
