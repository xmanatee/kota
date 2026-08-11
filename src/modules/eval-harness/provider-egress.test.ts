import { describe, expect, it } from "vitest";
import {
  ANTIGRAVITY_CLI_PROVIDER_AUTH_ENV_KEYS,
  ANTIGRAVITY_CLI_PROVIDER_EGRESS_HOSTS,
} from "#modules/antigravity-cli-agent-harness/provider-egress.js";
import {
  providerEgressAuthEnvKeysFor,
  providerEgressEndpointLabelValue,
  providerEgressEndpointsFor,
  providerEgressProviderForPreset,
} from "./provider-egress.js";

describe("provider-egress provider catalog", () => {
  it("derives Google egress and auth from the Antigravity adapter contract", () => {
    expect(
      providerEgressEndpointsFor("google").map((endpoint) => endpoint.host),
    ).toEqual([...ANTIGRAVITY_CLI_PROVIDER_EGRESS_HOSTS]);
    expect(providerEgressAuthEnvKeysFor("google")).toEqual([
      ...ANTIGRAVITY_CLI_PROVIDER_AUTH_ENV_KEYS,
    ]);
  });

  it("includes OpenRouter endpoint and auth metadata", () => {
    const endpoints = providerEgressEndpointsFor("openrouter");

    expect(providerEgressEndpointLabelValue(endpoints)).toBe(
      "https://openrouter.ai:443",
    );
    expect(providerEgressAuthEnvKeysFor("openrouter")).toEqual([
      "OPENROUTER_API_KEY",
    ]);
  });

  it("resolves the OpenRouter preset to OpenRouter even though it shares openai-tools", () => {
    expect(
      providerEgressProviderForPreset({
        id: "openrouter",
        harness: "openai-tools",
        defaultModel: "openrouter/openai/gpt-4.1-mini",
      }),
    ).toBe("openrouter");
  });
});
