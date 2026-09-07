import { afterEach, describe, expect, it, vi } from "vitest";
import { evaluateWeeklyQuota, QuotaGuard } from "./quota-guard.js";

const now = Date.UTC(2026, 8, 7, 12);
const day = 86_400_000;
afterEach(() => vi.useRealTimers());

describe("weekly quota admission", () => {
  it.each([
    [3 * day, 70, true, 30],
    [3 * day - 1, 70, false, 20],
    [day, 90, true, 10],
    [day - 1, 99, false, 0],
    [day - 1, 100, true, 0],
  ])("applies the reserve at %i milliseconds before reset", (left, used, blocked, reserve) => {
    expect(evaluateWeeklyQuota({ usedPercent: used, resetsAt: (now + left) / 1000 }, 10, now))
      .toEqual({ blocked, remaining: 100 - used, reserve });
  });

  it("rejects expired windows rather than granting a new allowance", () => {
    expect(() => evaluateWeeklyQuota({ usedPercent: 90, resetsAt: now / 1000 }, 10, now)).toThrow("expired");
  });

  it("resumes at a day boundary, preserves its hold on probe failure, and stops polling when disabled", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    let held = false;
    const read = vi.fn(async () => ({ usedPercent: 90, resetsAt: (now + day) / 1000 }));
    const guard = new QuotaGuard({
      hold: () => { held = true; },
      release: () => { held = false; },
      log: () => {},
    });
    guard.configure({ enabled: true, reservePercentPerDay: 10 }, read);
    expect(held).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(guard.message).toContain("10% reserved");
    read.mockRejectedValueOnce(new Error("offline"));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(held).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(held).toBe(false);
    guard.configure({ enabled: false, reservePercentPerDay: 10 }, read);
    const calls = read.mock.calls.length;
    await vi.advanceTimersByTimeAsync(day);
    expect(read.mock.calls.length).toBe(calls);
    guard.stop();
  });

  it("ignores a late probe after configuration changes and closes admission without a quota provider", async () => {
    let resolve!: (value: { usedPercent: number; resetsAt: number }) => void;
    let held = false;
    const guard = new QuotaGuard({ hold: () => { held = true; }, release: () => { held = false; }, log: () => {} });
    guard.configure({ enabled: true, reservePercentPerDay: 10 }, () => new Promise((done) => { resolve = done; }));
    guard.configure(undefined, undefined);
    resolve({ usedPercent: 100, resetsAt: (Date.now() + day) / 1000 });
    await Promise.resolve();
    expect(held).toBe(false);
    guard.configure({ enabled: true, reservePercentPerDay: 10 }, undefined);
    expect(held).toBe(true);
    expect(guard.message).toContain("does not support");
    guard.stop();
  });
});
