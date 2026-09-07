import { describe, expect, it } from "vitest";
import { decodeCodexWeeklyQuota } from "./quota.js";

const weekly = { usedPercent: 42, windowDurationMins: 10_080, resetsAt: 2_000_000_000 };
const hourly = { ...weekly, windowDurationMins: 300 };

describe("Codex account quota decoding", () => {
  it.each(["primary", "secondary"])("finds the weekly %s window in the authoritative Codex bucket", (key) => {
    expect(decodeCodexWeeklyQuota({
      rateLimits: { primary: { ...weekly, usedPercent: 99 } },
      rateLimitsByLimitId: { codex: { [key]: weekly }, spark: { primary: { ...weekly, usedPercent: 0 } } },
    })).toEqual({ usedPercent: 42, resetsAt: weekly.resetsAt });
  });
  it("accepts the documented single-bucket response", () => {
    expect(decodeCodexWeeklyQuota({ rateLimits: { limitId: "codex", primary: hourly, secondary: weekly } }))
      .toEqual({ usedPercent: 42, resetsAt: weekly.resetsAt });
  });
  it.each([
    { rateLimitsByLimitId: { spark: { primary: weekly } } },
    { rateLimits: { primary: hourly } },
    { rateLimits: { primary: weekly, secondary: weekly } },
    { rateLimits: { primary: { ...weekly, usedPercent: -1 } } },
    { rateLimits: { primary: { ...weekly, resetsAt: null } } },
  ])("rejects missing, ambiguous, or malformed weekly allowance", (response) => {
    expect(() => decodeCodexWeeklyQuota(response)).toThrow();
  });
});
