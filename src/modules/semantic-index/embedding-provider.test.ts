import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { outboundHttpRequestPort } from "#core/outbound-http/testing/request-port.js";
import { createEmbeddingProvider, HttpEmbeddingProvider, readEmbeddingProviderConfig } from "./embedding-provider.js";

describe("embedding provider boundary", () => {
  beforeEach(() => {
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
    vi.stubEnv("VOYAGE_API_KEY", "test-voyage-key");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("rejects missing credentials", () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    expect(() => createEmbeddingProvider({ provider: "openai", model: "m" })).toThrow(/No API key/);
  });

  it.each([
    { provider: "openai" as const, url: "https://api.openai.com/v1/embeddings", key: "test-openai-key" },
    { provider: "voyage" as const, url: "https://api.voyageai.com/v1/embeddings", key: "test-voyage-key" },
  ])("sends the configured model, inputs, and credentials to $provider", async ({ provider, url, key }) => {
    const request = vi.fn(async () => new Response(JSON.stringify({ data: [{ index: 0, embedding: [1, 2] }] })));
    const client = new HttpEmbeddingProvider({ provider, model: "chosen-model" }, outboundHttpRequestPort(request));
    expect(await client.embed(["authored input"])).toEqual([[1, 2]]);
    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      url, method: "POST", headers: expect.objectContaining({ Authorization: `Bearer ${key}` }),
      body: JSON.stringify({ input: ["authored input"], model: "chosen-model" }),
    }));
  });

  it("honors endpoint and credential overrides and restores response input order", async () => {
    const request = vi.fn(async () => new Response(JSON.stringify({ data: [
      { index: 1, embedding: [2] }, { index: 0, embedding: [1] },
    ] })));
    const client = new HttpEmbeddingProvider({
      provider: "openai", model: "m", baseUrl: "http://localhost:11434/v1/", apiKey: "override-key",
    }, outboundHttpRequestPort(request));
    expect(await client.embed(["a", "b"])).toEqual([[1], [2]]);
    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      url: "http://localhost:11434/v1/embeddings",
      headers: expect.objectContaining({ Authorization: "Bearer override-key" }),
    }));
  });

  it("avoids an empty request and propagates an HTTP failure for nonempty input", async () => {
    const request = vi.fn(async () => new Response("boom", { status: 500, statusText: "Server Error" }));
    const client = new HttpEmbeddingProvider({ provider: "openai", model: "m" }, outboundHttpRequestPort(request));
    expect(await client.embed([])).toEqual([]);
    expect(request).not.toHaveBeenCalled();
    await expect(client.embed(["x"])).rejects.toThrow(/500/);
  });

  it.each([undefined, {}, { provider: "openai" }, { provider: "bogus", model: "m" }, { provider: "openai", model: "" }])(
    "rejects missing or invalid configuration: %j", (input) => {
      expect(readEmbeddingProviderConfig(input)).toBeNull();
    },
  );

  it.each([
    { provider: "openai", model: "m" },
    { provider: "voyage", model: "m", apiKey: "override-key", baseUrl: "https://custom.example/v1" },
  ])("propagates valid configuration: %j", (input) => {
    expect(readEmbeddingProviderConfig(input)).toEqual(input);
  });
});
