import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  initProviderRegistry,
  MODEL_PRICING_PROVIDER_TOKEN,
  type ModelPricing,
  type ModelPricingProvider,
  resetProviderRegistry,
} from "#core/modules/provider-registry.js";
import { CostTracker } from "./cost.js";

const TEST_PRICING: Record<string, ModelPricing> = {
  "claude-sonnet-4-6": { kind: "flat", input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  "claude-opus-4-7": { kind: "flat", input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-haiku-4-5-20251001": { kind: "flat", input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
  "tiered-model": {
    kind: "input-token-tiered",
    tiers: [
      { maxInputTokens: 200_000, rates: { input: 1, output: 10, cacheRead: 0.1, cacheWrite: 1 } },
      { maxInputTokens: null, rates: { input: 2, output: 15, cacheRead: 0.2, cacheWrite: 2 } },
    ],
  },
  "malformed-tiered-model": {
    kind: "input-token-tiered",
    tiers: [
      { maxInputTokens: 100, rates: { input: 1, output: 10, cacheRead: 0.1, cacheWrite: 1 } },
    ],
  },
};

const testPricingProvider: ModelPricingProvider = {
  getPricing(model: string) {
    return TEST_PRICING[model] ?? null;
  },
};

describe("CostTracker", () => {
  beforeEach(() => {
    const reg = initProviderRegistry();
    reg.register(MODEL_PRICING_PROVIDER_TOKEN, "test", testPricingProvider);
  });

  afterEach(() => {
    resetProviderRegistry();
  });

  it("starts at zero cost", () => {
    const tracker = new CostTracker();
    expect(tracker.getTotalCost()).toBe(0);
  });

  it("calculates sonnet pricing correctly", () => {
    const tracker = new CostTracker();
    tracker.addUsage("claude-sonnet-4-6", {
      input_tokens: 1_000_000,
      output_tokens: 0,
    });
    // Sonnet input = $3/M tokens
    expect(tracker.getTotalCost()).toBeCloseTo(3.0);
  });

  it("calculates output token cost", () => {
    const tracker = new CostTracker();
    tracker.addUsage("claude-sonnet-4-6", {
      input_tokens: 0,
      output_tokens: 1_000_000,
    });
    // Sonnet output = $15/M tokens
    expect(tracker.getTotalCost()).toBeCloseTo(15.0);
  });

  it("calculates cache read pricing", () => {
    const tracker = new CostTracker();
    tracker.addUsage("claude-sonnet-4-6", {
      input_tokens: 0,
      output_tokens: 0,
      cache_read_input_tokens: 1_000_000,
    });
    // Sonnet cache read = $0.3/M
    expect(tracker.getTotalCost()).toBeCloseTo(0.3);
  });

  it("calculates cache write pricing", () => {
    const tracker = new CostTracker();
    tracker.addUsage("claude-sonnet-4-6", {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 1_000_000,
    });
    // Sonnet cache write = $3.75/M
    expect(tracker.getTotalCost()).toBeCloseTo(3.75);
  });

  it("uses opus pricing for opus model", () => {
    const tracker = new CostTracker();
    tracker.addUsage("claude-opus-4-7", {
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
    });
    // Opus: $5/M input + $25/M output = $30
    expect(tracker.getTotalCost()).toBeCloseTo(30.0);
  });

  it("uses haiku pricing for haiku model", () => {
    const tracker = new CostTracker();
    tracker.addUsage("claude-haiku-4-5-20251001", {
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
    });
    // Haiku: $1/M input + $5/M output = $6
    expect(tracker.getTotalCost()).toBeCloseTo(6.0);
  });

  it("selects tiered pricing from input token count", () => {
    const tracker = new CostTracker();
    tracker.addUsage("tiered-model", {
      input_tokens: 200_001,
      output_tokens: 1_000_000,
      cache_read_input_tokens: 1_000_000,
      cache_creation_input_tokens: 1_000_000,
    });
    expect(tracker.getTotalCost()).toBeCloseTo(
      (200_001 * 2 + 1_000_000 * 15 + 1_000_000 * 0.2 + 1_000_000 * 2) / 1_000_000,
    );
  });

  it("fails loudly when tiered pricing has a gap", () => {
    const tracker = new CostTracker();
    expect(() =>
      tracker.addUsage("malformed-tiered-model", {
        input_tokens: 101,
        output_tokens: 1,
      }),
    ).toThrow(/Tiered model pricing does not cover 101 input token/);
  });

  it("contributes zero cost for models with no registered pricing", () => {
    // Unknown-model contract: no Sonnet-rate fallback, no silent peer-model
    // approximation. The seam returns null and addUsage records $0 — token
    // counts still accumulate so the summary stays informative.
    const tracker = new CostTracker();
    tracker.addUsage("claude-unknown-model", {
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
      cache_read_input_tokens: 1_000_000,
      cache_creation_input_tokens: 1_000_000,
    });
    expect(tracker.getTotalCost()).toBe(0);
    expect(tracker.getSummary()).toContain("$0.0000");
    expect(tracker.getSummary()).toContain("1.0M in");
    expect(tracker.getSummary()).toContain("1.0M out");
  });

  it("contributes zero cost when no model-pricing provider is registered at all", () => {
    resetProviderRegistry();
    initProviderRegistry();
    const tracker = new CostTracker();
    tracker.addUsage("claude-sonnet-4-6", {
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
    });
    expect(tracker.getTotalCost()).toBe(0);
  });

  it("accumulates cost across multiple calls", () => {
    const tracker = new CostTracker();
    tracker.addUsage("claude-sonnet-4-6", {
      input_tokens: 500_000,
      output_tokens: 100_000,
    });
    tracker.addUsage("claude-sonnet-4-6", {
      input_tokens: 500_000,
      output_tokens: 100_000,
    });
    // 2 * (500K * 3/M + 100K * 15/M) = 2 * (1.5 + 1.5) = 6.0
    expect(tracker.getTotalCost()).toBeCloseTo(6.0);
  });

  it("handles null cache token fields", () => {
    const tracker = new CostTracker();
    tracker.addUsage("claude-sonnet-4-6", {
      input_tokens: 1000,
      output_tokens: 1000,
      cache_read_input_tokens: null,
      cache_creation_input_tokens: null,
    });
    // Should not throw, treats null as 0
    expect(tracker.getTotalCost()).toBeGreaterThan(0);
  });

  it("getSummary includes cost and token breakdown", () => {
    const tracker = new CostTracker();
    tracker.addUsage("claude-sonnet-4-6", {
      input_tokens: 50_000,
      output_tokens: 10_000,
      cache_read_input_tokens: 100_000,
    });
    const summary = tracker.getSummary();
    expect(summary).toContain("$");
    expect(summary).toContain("in");
    expect(summary).toContain("out");
    expect(summary).toContain("cache");
  });

  it("getSummary omits cache when zero", () => {
    const tracker = new CostTracker();
    tracker.addUsage("claude-sonnet-4-6", {
      input_tokens: 50_000,
      output_tokens: 10_000,
    });
    const summary = tracker.getSummary();
    expect(summary).not.toContain("cache");
  });

  it("formats large token counts with K/M suffixes", () => {
    const tracker = new CostTracker();
    tracker.addUsage("claude-sonnet-4-6", {
      input_tokens: 1_500_000,
      output_tokens: 2_500,
    });
    const summary = tracker.getSummary();
    expect(summary).toContain("1.5M in");
    expect(summary).toContain("2.5K out");
  });

  it("addRawCost adds pre-computed dollar cost", () => {
    const tracker = new CostTracker();
    tracker.addRawCost(0.15);
    expect(tracker.getTotalCost()).toBeCloseTo(0.15);
  });

  it("getTotalCost allows computing per-turn delta across multiple turns", () => {
    const tracker = new CostTracker();

    const prev1 = tracker.getTotalCost();
    tracker.addUsage("claude-sonnet-4-6", { input_tokens: 1_000_000, output_tokens: 0 });
    const turn1Cost = tracker.getTotalCost() - prev1;
    const total1 = tracker.getTotalCost();
    // Turn 1: 1M input at $3/M = $3
    expect(turn1Cost).toBeCloseTo(3.0);
    expect(total1).toBeCloseTo(3.0);

    const prev2 = tracker.getTotalCost();
    tracker.addUsage("claude-sonnet-4-6", { input_tokens: 0, output_tokens: 1_000_000 });
    const turn2Cost = tracker.getTotalCost() - prev2;
    const total2 = tracker.getTotalCost();
    // Turn 2: 1M output at $15/M = $15
    expect(turn2Cost).toBeCloseTo(15.0);
    expect(total2).toBeCloseTo(18.0);
    // Per-turn costs sum to total
    expect(turn1Cost + turn2Cost).toBeCloseTo(total2);
  });

  it("addRawCost accumulates with token-based cost", () => {
    const tracker = new CostTracker();
    tracker.addUsage("claude-sonnet-4-6", {
      input_tokens: 1_000_000,
      output_tokens: 0,
    });
    tracker.addRawCost(0.5);
    // $3 from tokens + $0.5 raw = $3.5
    expect(tracker.getTotalCost()).toBeCloseTo(3.5);
  });
});
