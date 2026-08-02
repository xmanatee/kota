import { describe, expect, it, vi } from "vitest";
import { resolveScopePolicy } from "#core/daemon/scope-policy.js";
import { runAgentHarness } from "./runner.js";
import type { AgentHarness } from "./types.js";

describe("runAgentHarness scope policy boundary", () => {
  it("rejects an unsupported scope policy before native adapter launch", async () => {
    const run = vi.fn(async () => ({
      text: "unexpected",
      streamedText: "unexpected",
      turns: 1,
      isError: false,
    }));
    const harness: AgentHarness = {
      name: "native-scope-policy",
      description: "native scope-policy fixture",
      supportsMultiTurn: false,
      supportedHookKinds: [],
      askOwnerToolName: null,
      emitsAgentMessageStream: false,
      toolControl: "native",
      unsupportedRunOptions: [{
        runOption: "scopePolicy",
        option: "scopePolicy",
        reason: "native tool calls cannot pass through KOTA scope policy",
      }],
      run,
    };
    const scopePolicy = resolveScopePolicy({
      projection: {
        rootScopeId: "global",
        defaultScopeId: "global",
        scopes: [{ scopeId: "global", displayName: "Global" }],
      },
      scopeId: "global",
    });

    await expect(
      runAgentHarness(harness, {
        prompt: "x",
        effort: "xhigh",
        scopePolicy,
      }),
    ).rejects.toThrow(/native-scope-policy.*scopePolicy.*cannot pass through/);
    expect(run).not.toHaveBeenCalled();
  });
});
