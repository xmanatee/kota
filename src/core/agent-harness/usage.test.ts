import { describe, expect, it } from "vitest";
import { AgentUsageAccumulator, parseAgentUsage } from "./usage.js";

describe("parseAgentUsage", () => {
  it("decodes every canonical completeness state", () => {
    expect(parseAgentUsage({
      tokens: { state: "complete", inputTokens: 12, outputTokens: 3 },
      cost: { state: "complete", usd: 0.25 },
    }, "usage")).toEqual({
      tokens: { state: "complete", inputTokens: 12, outputTokens: 3 },
      cost: { state: "complete", usd: 0.25 },
    });
    expect(parseAgentUsage({
      tokens: { state: "partial", inputTokens: 12, outputTokens: 0 },
      cost: { state: "unavailable", reason: "provider-does-not-report" },
    }, "usage")).toEqual({
      tokens: { state: "partial", inputTokens: 12, outputTokens: 0 },
      cost: { state: "unavailable", reason: "provider-does-not-report" },
    });
    expect(parseAgentUsage({
      tokens: { state: "unknown" },
      cost: { state: "unknown" },
    }, "usage")).toEqual({
      tokens: { state: "unknown" },
      cost: { state: "unknown" },
    });
  });

  it("rejects malformed and legacy scalar usage", () => {
    expect(() => parseAgentUsage({
      inputTokens: 12,
      outputTokens: 3,
      totalCostUsd: 0.25,
    }, "usage")).toThrow("usage contains unexpected fields");
    expect(() => parseAgentUsage({
      tokens: { state: "complete", inputTokens: 1.5, outputTokens: 3 },
      cost: { state: "complete", usd: 0.25 },
    }, "usage")).toThrow("usage.tokens.inputTokens must be a non-negative integer");
    expect(() => parseAgentUsage({
      tokens: { state: "unknown", inputTokens: 0 },
      cost: { state: "unknown" },
    }, "usage")).toThrow("usage.tokens contains unexpected field");
  });
});

describe("AgentUsageAccumulator", () => {
  it("sums complete invocation usage", () => {
    const usage = new AgentUsageAccumulator();
    usage.observe({
      tokens: { state: "complete", inputTokens: 10, outputTokens: 2 },
      cost: { state: "complete", usd: 1 },
    });
    usage.observe({
      tokens: { state: "complete", inputTokens: 20, outputTokens: 3 },
      cost: { state: "complete", usd: 2 },
    });

    expect(usage.snapshot()).toEqual({
      tokens: { state: "complete", inputTokens: 30, outputTokens: 5 },
      cost: { state: "complete", usd: 3 },
    });
  });

  it("marks measured tokens partial when another invocation is unknown", () => {
    const usage = new AgentUsageAccumulator();
    usage.observe({
      tokens: { state: "complete", inputTokens: 10, outputTokens: 2 },
      cost: { state: "unavailable", reason: "provider-does-not-report" },
    });
    usage.observe({
      tokens: { state: "unknown" },
      cost: { state: "unavailable", reason: "provider-does-not-report" },
    });

    expect(usage.snapshot()).toEqual({
      tokens: { state: "partial", inputTokens: 10, outputTokens: 2 },
      cost: { state: "unavailable", reason: "provider-does-not-report" },
    });
  });
});
