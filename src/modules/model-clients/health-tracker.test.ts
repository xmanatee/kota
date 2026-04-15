import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderHealthTracker } from "./health-tracker.js";

vi.mock("#core/events/event-bus.js", () => ({
  tryEmit: vi.fn(),
}));

import { tryEmit } from "#core/events/event-bus.js";

function makeTracker(overrides?: Partial<{ windowMs: number; errorThreshold: number; cooldownMs: number }>) {
  return new ProviderHealthTracker({
    windowMs: overrides?.windowMs ?? 60_000,
    errorThreshold: overrides?.errorThreshold ?? 3,
    cooldownMs: overrides?.cooldownMs ?? 10_000,
    primaryName: "anthropic",
    fallbackName: "openai",
  });
}

describe("ProviderHealthTracker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts healthy", () => {
    const tracker = makeTracker();
    expect(tracker.isHealthy()).toBe(true);
    expect(tracker.getHealthState().status).toBe("healthy");
  });

  it("stays healthy below error threshold", () => {
    const tracker = makeTracker({ errorThreshold: 3 });
    tracker.recordError();
    tracker.recordError();
    expect(tracker.isHealthy()).toBe(true);
    expect(tryEmit).not.toHaveBeenCalled();
  });

  it("transitions to unhealthy at error threshold", () => {
    const tracker = makeTracker({ errorThreshold: 3 });
    tracker.recordError();
    tracker.recordError();
    tracker.recordError();
    expect(tracker.isHealthy()).toBe(false);
    expect(tryEmit).toHaveBeenCalledWith("model.provider.failover", expect.objectContaining({
      from: "anthropic",
      to: "openai",
      direction: "failover",
    }));
  });

  it("shouldProbe returns false before cooldown", () => {
    const tracker = makeTracker({ errorThreshold: 1, cooldownMs: 10_000 });
    tracker.recordError();
    expect(tracker.shouldProbe()).toBe(false);
    vi.advanceTimersByTime(5_000);
    expect(tracker.shouldProbe()).toBe(false);
  });

  it("shouldProbe returns true after cooldown", () => {
    const tracker = makeTracker({ errorThreshold: 1, cooldownMs: 10_000 });
    tracker.recordError();
    vi.advanceTimersByTime(10_000);
    expect(tracker.shouldProbe()).toBe(true);
  });

  it("markRecovered resets to healthy and emits recovery event", () => {
    const tracker = makeTracker({ errorThreshold: 1 });
    tracker.recordError();
    vi.clearAllMocks();
    tracker.markRecovered();
    expect(tracker.isHealthy()).toBe(true);
    expect(tryEmit).toHaveBeenCalledWith("model.provider.failover", expect.objectContaining({
      from: "openai",
      to: "anthropic",
      direction: "recovery",
    }));
  });

  it("markProbeFailed resets cooldown timer", () => {
    const tracker = makeTracker({ errorThreshold: 1, cooldownMs: 10_000 });
    tracker.recordError();
    vi.advanceTimersByTime(10_000);
    expect(tracker.shouldProbe()).toBe(true);
    tracker.markProbeFailed();
    expect(tracker.shouldProbe()).toBe(false);
    vi.advanceTimersByTime(10_000);
    expect(tracker.shouldProbe()).toBe(true);
  });

  it("errors outside the window do not count", () => {
    const tracker = makeTracker({ errorThreshold: 3, windowMs: 5_000 });
    tracker.recordError();
    tracker.recordError();
    vi.advanceTimersByTime(6_000);
    tracker.recordError();
    expect(tracker.isHealthy()).toBe(true);
  });

  it("getHealthState reports error counts", () => {
    const tracker = makeTracker({ errorThreshold: 5 });
    tracker.recordSuccess();
    tracker.recordError();
    tracker.recordSuccess();
    const state = tracker.getHealthState();
    expect(state.errorCount).toBe(1);
    expect(state.totalCount).toBe(3);
    expect(state.lastErrorAt).not.toBeNull();
  });
});
