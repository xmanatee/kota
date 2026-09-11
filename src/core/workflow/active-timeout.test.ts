import { afterEach, describe, expect, it, vi } from "vitest";
import { createActiveTimeout, createWorkflowStepActiveTimeoutError } from "./active-timeout.js";
import { type ActiveClock, type ActiveClockObservation, darwinSuspendedMs } from "./host-suspension.js";

afterEach(() => vi.useRealTimers());

describe("workflow active deadline", () => {
  it("creates the operator-facing message", () => {
    expect(createWorkflowStepActiveTimeoutError("review-evidence", 1_800_000).message)
      .toBe('Step "review-evidence" timed out after 1800000ms of active runtime');
  });

  it.each(["starvation", "wall-clock-adjustment", "sleep-continuous", "sleep-monotonic"] as const)(
    "accounts for %s using independent suspension evidence",
    async (kind) => {
      vi.useFakeTimers();
      let now: ActiveClockObservation = { monotonicMs: 0, wallMs: 0,
        ...(kind === "sleep-monotonic" ? { bootMs: 0 } : {}) };
      const clock: ActiveClock = {
        observe: () => now,
        suspendedBetween: () => kind.startsWith("sleep-") ? 60_000 : 0,
      };
      const expired = vi.fn();
      const timeout = createActiveTimeout(5_000, () => new Error("active deadline"), expired, clock);
      now = { monotonicMs: kind === "sleep-monotonic" || kind === "wall-clock-adjustment" ? 1_000 : 61_000,
        wallMs: 61_000, ...(kind === "sleep-monotonic" ? { bootMs: 61_000 } : {}) };
      await vi.advanceTimersByTimeAsync(1_000);
      expect(timeout.snapshot()).toEqual({
        activeElapsedMs: kind === "starvation" ? 61_000 : 1_000,
        suspendedMs: kind.startsWith("sleep-") ? 60_000 : 0,
      });
      expect(expired).toHaveBeenCalledTimes(kind === "starvation" ? 1 : 0);
      if (kind !== "starvation") {
        now = { ...now, monotonicMs: now.monotonicMs + 4_000, wallMs: now.wallMs + 4_000,
          ...(now.bootMs !== undefined ? { bootMs: now.bootMs + 4_000 } : {}) };
        await vi.advanceTimersByTimeAsync(1_000);
        expect(expired).toHaveBeenCalledOnce();
        expect(timeout.snapshot().activeElapsedMs).toBe(5_000);
      }
      timeout.dispose();
    },
  );
});

it("requires matching kernel sleep and wake observations before excluding a macOS interval", () => {
  const observations = "{ sec = 10, usec = 500000 }\n{ sec = 70, usec = 500000 }\n";
  expect(darwinSuspendedMs(observations, 10_000, 71_000)).toBe(60_000);
  expect(darwinSuspendedMs(observations, 20_000, 71_000)).toBe(50_500);
  expect(darwinSuspendedMs(observations, 71_000, 90_000)).toBe(0);
  expect(darwinSuspendedMs(observations, 10_000, 50_000)).toBe(0);
  expect(darwinSuspendedMs("unavailable", 10_000, 71_000)).toBe(0);
  expect(darwinSuspendedMs("{ sec = 70, usec = 0 }\n{ sec = 10, usec = 0 }", 0, 80_000)).toBe(0);
});
