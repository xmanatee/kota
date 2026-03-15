import { describe, expect, it } from "vitest";
import { CostTracker } from "./cost.js";

describe("CostTracker", () => {
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
    tracker.addUsage("claude-opus-4-6", {
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
    });
    // Opus: $15/M input + $75/M output = $90
    expect(tracker.getTotalCost()).toBeCloseTo(90.0);
  });

  it("uses haiku pricing for haiku model", () => {
    const tracker = new CostTracker();
    tracker.addUsage("claude-haiku-4-5-20251001", {
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
    });
    // Haiku: $0.8/M input + $4/M output = $4.8
    expect(tracker.getTotalCost()).toBeCloseTo(4.8);
  });

  it("falls back to sonnet pricing for unknown models", () => {
    const tracker = new CostTracker();
    tracker.addUsage("claude-unknown-model", {
      input_tokens: 1_000_000,
      output_tokens: 0,
    });
    expect(tracker.getTotalCost()).toBeCloseTo(3.0);
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
});
