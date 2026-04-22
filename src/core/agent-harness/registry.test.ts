import { afterEach, describe, expect, it } from "vitest";
import {
  clearAgentHarnessRegistryForTest,
  hasAgentHarness,
  listAgentHarnessNames,
  registerAgentHarness,
  resolveAgentHarness,
} from "./index.js";
import type { AgentHarness } from "./types.js";

function stubHarness(name: string): AgentHarness {
  return {
    name,
    description: `stub ${name}`,
    supportsMultiTurn: true,
    supportedHookKinds: ["preRun", "postRun"],
    run: async () => ({
      text: "",
      streamedText: "",
      turns: 0,
      isError: false,
    }),
  };
}

describe("agent harness registry", () => {
  afterEach(() => {
    clearAgentHarnessRegistryForTest();
  });

  it("registers and resolves harnesses by name", () => {
    const claude = stubHarness("claude-agent-sdk");
    const thin = stubHarness("thin");
    registerAgentHarness(claude);
    registerAgentHarness(thin);
    expect(resolveAgentHarness("claude-agent-sdk")).toBe(claude);
    expect(resolveAgentHarness("thin")).toBe(thin);
    expect(hasAgentHarness("thin")).toBe(true);
    expect(listAgentHarnessNames()).toEqual(["claude-agent-sdk", "thin"]);
  });

  it("throws with available names when resolving an unknown harness", () => {
    registerAgentHarness(stubHarness("thin"));
    expect(() => resolveAgentHarness("claude-agent-sdk")).toThrow(
      /Unknown agent harness "claude-agent-sdk".*registered: thin/,
    );
  });

  it("throws with no-harness hint when the registry is empty", () => {
    expect(() => resolveAgentHarness("claude-agent-sdk")).toThrow(
      /no harnesses are registered/,
    );
  });

  it("rejects harnesses with invalid names", () => {
    expect(() =>
      registerAgentHarness({ ...stubHarness(""), name: "" }),
    ).toThrow(/non-empty string name/);
  });

  it("replaces on re-registration so module reloads stay consistent", () => {
    registerAgentHarness(stubHarness("thin"));
    const replacement = stubHarness("thin");
    registerAgentHarness(replacement);
    expect(resolveAgentHarness("thin")).toBe(replacement);
  });
});
