import { describe, expect, it, vi } from "vitest";
import { createModelClientImpl } from "./factory.js";
import { OpenAIModelClient } from "./openai/client.js";
import { openRouterCapabilitiesToOpenAIModelCapabilities } from "./openrouter-capabilities.js";
import { resolveOpenRouterCandidateSet } from "./openrouter-catalog.js";

vi.mock("./openai/client.js", () => {
	const MockOpenAI = vi.fn(function (this: Record<string, unknown>) {
		this.messages = { stream: vi.fn(), create: vi.fn() };
	});
	return { OpenAIModelClient: MockOpenAI };
});

describe("OpenRouter capability mapping", () => {
	it("maps catalog capabilities to OpenAI-compatible request metadata", () => {
		const [catalogEntry] = resolveOpenRouterCandidateSet("openrouter-lab");
		if (!catalogEntry) throw new Error("expected an OpenRouter lab candidate");
		const capabilities = openRouterCapabilitiesToOpenAIModelCapabilities(catalogEntry);

		expect(capabilities).toMatchObject({
			modelId: catalogEntry.id,
			maxOutputTokens: catalogEntry.maxOutputTokens,
			supportsTools: catalogEntry.supportsTools,
			supportsToolChoice: catalogEntry.supportsToolChoice,
			supportsIncludeReasoning: catalogEntry.supportedParameters.includes(
				"include_reasoning",
			),
			supportsStructuredOutputs: catalogEntry.supportsStructuredOutputs,
			reasoningEffortLevels: catalogEntry.reasoningEffortLevels,
		});
	});

	it("passes known OpenRouter model capabilities to the OpenAI client", () => {
		vi.clearAllMocks();
		const [catalogEntry] = resolveOpenRouterCandidateSet("openrouter-lab");
		if (!catalogEntry) throw new Error("expected an OpenRouter lab candidate");
		const result = createModelClientImpl({
			model: catalogEntry.providerModelId,
		});

		expect(result.providerName).toBe("openrouter");
		expect(result.model).toBe(catalogEntry.id);
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
			modelId: catalogEntry.id,
			supportsTools: catalogEntry.supportsTools,
			supportsToolChoice: catalogEntry.supportsToolChoice,
			supportsIncludeReasoning: catalogEntry.supportedParameters.includes(
				"include_reasoning",
			),
			reasoningEffortLevels: catalogEntry.reasoningEffortLevels,
		});
	});
});
