import { describe, expect, it, vi } from "vitest";
import { createModelClientImpl } from "./factory.js";
import { OpenAIModelClient } from "./openai/client.js";
import { openRouterCapabilitiesToOpenAIModelCapabilities } from "./openrouter-capabilities.js";
import { getOpenRouterModelCapabilities } from "./openrouter-catalog.js";

vi.mock("./openai/client.js", () => {
	const MockOpenAI = vi.fn(function (this: Record<string, unknown>) {
		this.messages = { stream: vi.fn(), create: vi.fn() };
	});
	return { OpenAIModelClient: MockOpenAI };
});

describe("OpenRouter capability mapping", () => {
	it("maps catalog capabilities to OpenAI-compatible request metadata", () => {
		const capabilities = openRouterCapabilitiesToOpenAIModelCapabilities(
			getOpenRouterModelCapabilities("z-ai/glm-5.2"),
		);

		expect(capabilities).toMatchObject({
			modelId: "z-ai/glm-5.2",
			maxOutputTokens: 32768,
			supportsTools: true,
			supportsToolChoice: true,
			supportsIncludeReasoning: true,
			supportsStructuredOutputs: true,
			reasoningEffortLevels: ["xhigh", "high"],
		});
	});

	it("passes known OpenRouter model capabilities to the OpenAI client", () => {
		vi.clearAllMocks();
		const result = createModelClientImpl({
			model: "openrouter/z-ai/glm-5.2",
		});

		expect(result.providerName).toBe("openrouter");
		expect(result.model).toBe("z-ai/glm-5.2");
		const call = (OpenAIModelClient as unknown as { mock: { calls: unknown[][] } })
			.mock.calls[0][0] as {
			modelCapabilities?: {
				modelId: string;
				supportsTools?: boolean;
				supportsToolChoice?: boolean;
				supportsIncludeReasoning?: boolean;
				reasoningEffortLevels?: readonly string[];
			};
		};
		expect(call.modelCapabilities).toMatchObject({
			modelId: "z-ai/glm-5.2",
			supportsTools: true,
			supportsToolChoice: true,
			supportsIncludeReasoning: true,
			reasoningEffortLevels: ["xhigh", "high"],
		});
	});
});
