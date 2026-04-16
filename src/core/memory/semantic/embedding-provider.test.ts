import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createEmbeddingProvider,
	HttpEmbeddingProvider,
	readEmbeddingProviderConfig,
} from "./embedding-provider.js";

const originalFetch = globalThis.fetch;

describe("HttpEmbeddingProvider", () => {
	beforeEach(() => {
		process.env.OPENAI_API_KEY = "test-openai-key";
		process.env.VOYAGE_API_KEY = "test-voyage-key";
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		delete process.env.OPENAI_API_KEY;
		delete process.env.VOYAGE_API_KEY;
	});

	it("throws when no API key is provided", () => {
		delete process.env.OPENAI_API_KEY;
		expect(() =>
			createEmbeddingProvider({ provider: "openai", model: "text-embedding-3-small" }),
		).toThrow(/No API key/);
	});

	it("defaults to the OpenAI base URL when no override given", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({ data: [{ index: 0, embedding: [0.1, 0.2] }] }),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			),
		);
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const provider = new HttpEmbeddingProvider({
			provider: "openai",
			model: "text-embedding-3-small",
		});
		const result = await provider.embed(["hello"]);
		expect(result).toEqual([[0.1, 0.2]]);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe("https://api.openai.com/v1/embeddings");
		const parsed = JSON.parse((init as RequestInit).body as string);
		expect(parsed).toEqual({ input: ["hello"], model: "text-embedding-3-small" });
		expect((init as RequestInit).headers).toMatchObject({
			Authorization: "Bearer test-openai-key",
		});
	});

	it("uses the voyage preset when provider is voyage", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({ data: [{ index: 0, embedding: [1, 0] }] }),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			),
		);
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const provider = new HttpEmbeddingProvider({
			provider: "voyage",
			model: "voyage-3",
		});
		await provider.embed(["hi"]);
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe("https://api.voyageai.com/v1/embeddings");
		expect((init as RequestInit).headers).toMatchObject({
			Authorization: "Bearer test-voyage-key",
		});
	});

	it("honors baseUrl and explicit apiKey overrides", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ data: [{ index: 0, embedding: [1] }] }), { status: 200 }),
		);
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const provider = new HttpEmbeddingProvider({
			provider: "openai",
			model: "m",
			baseUrl: "http://localhost:11434/v1/",
			apiKey: "override-key",
		});
		await provider.embed(["x"]);
		expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:11434/v1/embeddings");
		expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toMatchObject({
			Authorization: "Bearer override-key",
		});
	});

	it("returns vectors in the order of the input", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					data: [
						{ index: 1, embedding: [2] },
						{ index: 0, embedding: [1] },
					],
				}),
				{ status: 200 },
			),
		);
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const provider = new HttpEmbeddingProvider({ provider: "openai", model: "m" });
		const result = await provider.embed(["a", "b"]);
		expect(result).toEqual([[1], [2]]);
	});

	it("throws on HTTP error", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue(
			new Response("boom", { status: 500, statusText: "Server Error" }),
		) as unknown as typeof fetch;

		const provider = new HttpEmbeddingProvider({ provider: "openai", model: "m" });
		await expect(provider.embed(["x"])).rejects.toThrow(/500/);
	});

	it("returns [] for empty input without hitting the API", async () => {
		const fetchMock = vi.fn();
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const provider = new HttpEmbeddingProvider({ provider: "openai", model: "m" });
		expect(await provider.embed([])).toEqual([]);
		expect(fetchMock).not.toHaveBeenCalled();
	});
});

describe("readEmbeddingProviderConfig", () => {
	it("returns null for missing or invalid config", () => {
		expect(readEmbeddingProviderConfig(undefined)).toBeNull();
		expect(readEmbeddingProviderConfig({})).toBeNull();
		expect(readEmbeddingProviderConfig({ provider: "openai" })).toBeNull();
		expect(readEmbeddingProviderConfig({ provider: "bogus", model: "m" })).toBeNull();
		expect(readEmbeddingProviderConfig({ provider: "openai", model: "" })).toBeNull();
	});

	it("parses valid config with required fields", () => {
		expect(readEmbeddingProviderConfig({ provider: "openai", model: "m" })).toEqual({
			provider: "openai",
			model: "m",
		});
	});

	it("passes through optional overrides", () => {
		expect(
			readEmbeddingProviderConfig({
				provider: "voyage",
				model: "voyage-3",
				apiKey: "sk-x",
				baseUrl: "https://custom.example/v1",
			}),
		).toEqual({
			provider: "voyage",
			model: "voyage-3",
			apiKey: "sk-x",
			baseUrl: "https://custom.example/v1",
		});
	});
});
