import { afterEach, describe, expect, it, vi } from "vitest";
import { createModelClientImpl } from "./factory.js";
import { OpenAIModelClient } from "./openai/client.js";

vi.mock("./openai/client.js", () => ({ OpenAIModelClient: vi.fn(class {}) }));
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe("contained local model routing at the provider factory", () => {
  it.each([["ollama", 11434], ["lmstudio", 1234]] as const)("propagates the %s endpoint and rejects a mismatched route before client creation", (provider, port) => {
    const endpoint = `http://host.docker.internal:${port}/v1`;
    vi.stubEnv("KOTA_EVAL_PROVIDER_EGRESS_ACTIVE", "1");
    vi.stubEnv("KOTA_EVAL_PROVIDER_EGRESS_PROVIDER", provider);
    vi.stubEnv("KOTA_EVAL_LOCAL_MODEL_BASE_URL", endpoint);
    createModelClientImpl({ model: `${provider}/local-model` });
    expect(OpenAIModelClient).toHaveBeenLastCalledWith(expect.objectContaining({ baseUrl: endpoint, apiKey: "", presetName: provider }));
    vi.mocked(OpenAIModelClient).mockClear();
    expect(() => createModelClientImpl({ model: `${provider}/local-model`, baseUrl: "http://localhost:9999/v1" })).toThrow(/conflicts/);
    vi.stubEnv("KOTA_EVAL_PROVIDER_EGRESS_PROVIDER", "openrouter");
    expect(() => createModelClientImpl({ model: `${provider}/local-model` })).toThrow(/matching provider/);
    expect(OpenAIModelClient).not.toHaveBeenCalled();
  });

  it("preserves ordinary explicit local endpoints outside contained execution", () => {
    vi.stubEnv("KOTA_EVAL_PROVIDER_EGRESS_ACTIVE", "");
    createModelClientImpl({ model: "ollama/local-model", baseUrl: "http://localhost:9911/v1" });
    expect(OpenAIModelClient).toHaveBeenCalledWith(expect.objectContaining({ baseUrl: "http://localhost:9911/v1" }));
  });
});
