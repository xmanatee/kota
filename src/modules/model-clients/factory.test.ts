import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnthropicModelClient } from "./anthropic.js";
import {
	createModelClientImpl,
	PROVIDER_PRESETS,
	parseModelString,
	resolveApiKey,
} from "./factory.js";
import { OpenAIModelClient } from "./openai/client.js";

// Mock the actual SDK constructors so no real HTTP clients are created
vi.mock("./anthropic.js", () => {
	const MockAnthropic = vi.fn(function (this: Record<string, unknown>) {
		this.messages = { stream: vi.fn(), create: vi.fn() };
	});
	return { AnthropicModelClient: MockAnthropic };
});

vi.mock("./openai/client.js", () => {
	const MockOpenAI = vi.fn(function (this: Record<string, unknown>) {
		this.messages = { stream: vi.fn(), create: vi.fn() };
	});
	return { OpenAIModelClient: MockOpenAI };
});

describe("parseModelString", () => {
	it("returns just model when no slash", () => {
		expect(parseModelString("claude-sonnet-4-6")).toEqual({
			model: "claude-sonnet-4-6",
		});
	});

	it("splits provider/model on first slash", () => {
		expect(parseModelString("ollama/llama3")).toEqual({
			provider: "ollama",
			model: "llama3",
		});
	});

	it("handles openai/gpt-4o", () => {
		expect(parseModelString("openai/gpt-4o")).toEqual({
			provider: "openai",
			model: "gpt-4o",
		});
	});

	it("handles model with multiple slashes", () => {
		expect(parseModelString("together/meta-llama/Llama-3-70b")).toEqual({
			provider: "together",
			model: "meta-llama/Llama-3-70b",
		});
	});

	it("returns model only for empty prefix", () => {
		expect(parseModelString("/llama3")).toEqual({ model: "/llama3" });
	});
});

describe("resolveApiKey", () => {
	const originalEnv = { ...process.env };

	beforeEach(() => {
		process.env = { ...originalEnv };
	});

	afterEach(() => {
		process.env = originalEnv;
	});

	it("returns explicit key when provided", () => {
		expect(resolveApiKey("anthropic", "my-key")).toBe("my-key");
	});

	it("reads ANTHROPIC_API_KEY for anthropic provider", () => {
		process.env.ANTHROPIC_API_KEY = "sk-ant-test";
		expect(resolveApiKey("anthropic")).toBe("sk-ant-test");
	});

	it("reads provider-specific env var from preset", () => {
		process.env.GROQ_API_KEY = "gsk-test";
		expect(resolveApiKey("groq")).toBe("gsk-test");
	});

	it("falls back to OPENAI_API_KEY for unknown providers", () => {
		process.env.OPENAI_API_KEY = "sk-test";
		expect(resolveApiKey("custom-provider")).toBe("sk-test");
	});

	it("returns empty string for ollama (no key needed)", () => {
		delete process.env.OPENAI_API_KEY;
		expect(resolveApiKey("ollama")).toBe("");
	});
});

describe("PROVIDER_PRESETS", () => {
	it("has expected providers", () => {
		expect(Object.keys(PROVIDER_PRESETS)).toEqual(
			expect.arrayContaining([
				"openai",
				"ollama",
				"groq",
				"together",
				"lmstudio",
			]),
		);
	});

	it("ollama defaults to localhost:11434", () => {
		expect(PROVIDER_PRESETS.ollama.baseUrl).toBe(
			"http://localhost:11434/v1",
		);
	});
});

describe("createModelClientImpl", () => {
	const originalEnv = { ...process.env };

	beforeEach(() => {
		process.env = { ...originalEnv };
		vi.clearAllMocks();
	});

	afterEach(() => {
		process.env = originalEnv;
	});

	describe("anthropic provider", () => {
		it("creates AnthropicModelClient", () => {
			delete process.env.ANTHROPIC_API_KEY;
			const result = createModelClientImpl({ model: "claude-sonnet-4-6" });
			expect(result.providerName).toBe("anthropic");
			expect(result.model).toBe("claude-sonnet-4-6");
			expect(AnthropicModelClient).toHaveBeenCalledWith({
				maxRetries: 5,
			});
		});

		it("creates AnthropicModelClient even when ANTHROPIC_API_KEY is missing", () => {
			delete process.env.ANTHROPIC_API_KEY;
			const result = createModelClientImpl({ model: "claude-sonnet-4-6" });
			expect(result.providerName).toBe("anthropic");
			expect(AnthropicModelClient).toHaveBeenCalled();
		});

		it("passes explicit Anthropic API key from config", () => {
			const result = createModelClientImpl({
				model: "claude-sonnet-4-6",
				apiKey: "sk-ant-config",
			});

			expect(result.providerName).toBe("anthropic");
			expect(AnthropicModelClient).toHaveBeenCalledWith({
				maxRetries: 5,
				apiKey: "sk-ant-config",
			});
		});
	});

	describe("provider/model notation", () => {
		it("parses ollama/llama3 and creates OpenAIModelClient", () => {
			const result = createModelClientImpl({ model: "ollama/llama3" });
			expect(result.providerName).toBe("ollama");
			expect(result.model).toBe("llama3");
			expect(OpenAIModelClient).toHaveBeenCalledWith({
				baseUrl: "http://localhost:11434/v1",
				apiKey: "",
			});
		});

		it("parses openai/gpt-4o with OPENAI_API_KEY", () => {
			process.env.OPENAI_API_KEY = "sk-test";
			const result = createModelClientImpl({ model: "openai/gpt-4o" });
			expect(result.providerName).toBe("openai");
			expect(result.model).toBe("gpt-4o");
			expect(OpenAIModelClient).toHaveBeenCalledWith({
				baseUrl: "https://api.openai.com/v1",
				apiKey: "sk-test",
			});
		});

		it("parses groq/llama-70b with GROQ_API_KEY", () => {
			process.env.GROQ_API_KEY = "gsk-test";
			const result = createModelClientImpl({ model: "groq/llama-70b" });
			expect(result.providerName).toBe("groq");
			expect(result.model).toBe("llama-70b");
			expect(OpenAIModelClient).toHaveBeenCalledWith({
				baseUrl: "https://api.groq.com/openai/v1",
				apiKey: "gsk-test",
			});
		});
	});

	describe("explicit --provider flag", () => {
		it("overrides provider prefix in model string", () => {
			process.env.OPENAI_API_KEY = "sk-test";
			const result = createModelClientImpl({
				model: "ollama/llama3",
				provider: "openai",
			});
			expect(result.providerName).toBe("openai");
			expect(result.model).toBe("llama3");
			expect(OpenAIModelClient).toHaveBeenCalledWith({
				baseUrl: "https://api.openai.com/v1",
				apiKey: "sk-test",
			});
		});

		it("works with plain model name", () => {
			const result = createModelClientImpl({
				model: "llama3",
				provider: "ollama",
			});
			expect(result.providerName).toBe("ollama");
			expect(result.model).toBe("llama3");
		});
	});

	describe("explicit --base-url flag", () => {
		it("overrides preset base URL", () => {
			createModelClientImpl({
				model: "ollama/llama3",
				baseUrl: "http://custom:8080/v1",
			});
			expect(OpenAIModelClient).toHaveBeenCalledWith({
				baseUrl: "http://custom:8080/v1",
				apiKey: "",
			});
		});

		it("enables unknown provider with custom URL", () => {
			process.env.OPENAI_API_KEY = "sk-test";
			const result = createModelClientImpl({
				model: "my-model",
				provider: "vllm",
				baseUrl: "http://gpu-server:8000/v1",
			});
			expect(result.providerName).toBe("vllm");
			expect(result.model).toBe("my-model");
			expect(OpenAIModelClient).toHaveBeenCalledWith({
				baseUrl: "http://gpu-server:8000/v1",
				apiKey: "sk-test",
			});
		});
	});

	describe("error cases", () => {
		it("throws for unknown provider without base-url", () => {
			expect(() =>
				createModelClientImpl({
					model: "my-model",
					provider: "unknown-provider",
				}),
			).toThrow("Unknown provider");
			expect(() =>
				createModelClientImpl({
					model: "my-model",
					provider: "unknown-provider",
				}),
			).toThrow("--base-url");
		});
	});
});
