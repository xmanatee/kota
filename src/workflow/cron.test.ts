import { describe, expect, it } from "vitest";
import { getNextCronTime, validateCronExpr } from "./cron.js";

describe("validateCronExpr", () => {
  it("accepts valid 5-field expressions", () => {
    expect(validateCronExpr("0 2 * * *")).toBeNull();
    expect(validateCronExpr("*/15 * * * *")).toBeNull();
    expect(validateCronExpr("0 0 1 * *")).toBeNull();
    expect(validateCronExpr("30 6 * * 1-5")).toBeNull();
    expect(validateCronExpr("0 12 1,15 * *")).toBeNull();
    expect(validateCronExpr("0 0 * * 0")).toBeNull();
    expect(validateCronExpr("0 0 * * 7")).toBeNull(); // 7 = Sunday alias
  });

  it("rejects wrong field count", () => {
    expect(validateCronExpr("* * * *")).toMatch(/5 fields/);
    expect(validateCronExpr("* * * * * *")).toMatch(/5 fields/);
  });

  it("rejects invalid characters", () => {
    expect(validateCronExpr("abc * * * *")).toMatch(/invalid characters/);
  });
});

describe("getNextCronTime", () => {
  it("returns null for invalid expression", () => {
    expect(getNextCronTime("bad expr", new Date())).toBeNull();
  });

  it("fires at the next matching minute — daily at 2am", () => {
    // Start at 2026-01-01 01:55:00 UTC
    const from = new Date("2026-01-01T01:55:00.000Z");
    const next = getNextCronTime("0 2 * * *", from);
    expect(next).not.toBeNull();
    // Should fire at 2026-01-01 02:00:00 UTC
    expect(next!.getUTCHours()).toBe(2);
    expect(next!.getUTCMinutes()).toBe(0);
  });

  it("advances to the next day when current hour is past", () => {
    // Start at 2026-01-01 03:00:00 — already past 2am
    const from = new Date("2026-01-01T03:00:00.000Z");
    const next = getNextCronTime("0 2 * * *", from);
    expect(next).not.toBeNull();
    expect(next!.getUTCDate()).toBe(2);
    expect(next!.getUTCHours()).toBe(2);
  });

  it("handles step expressions — every 15 minutes", () => {
    const from = new Date("2026-01-01T00:00:00.000Z");
    const next = getNextCronTime("*/15 * * * *", from);
    expect(next).not.toBeNull();
    expect(next!.getUTCMinutes()).toBe(15);
  });

  it("handles day-of-week filter — Mondays at 9am", () => {
    // 2026-01-01 is a Thursday
    const from = new Date("2026-01-01T08:00:00.000Z");
    const next = getNextCronTime("0 9 * * 1", from);
    expect(next).not.toBeNull();
    expect(next!.getDay()).toBe(1); // Monday
    expect(next!.getUTCHours()).toBe(9);
  });

  it("handles month filter — 1st of March at midnight UTC", () => {
    const from = new Date("2026-01-15T00:00:00.000Z");
    const next = getNextCronTime("0 0 1 3 *", from);
    expect(next).not.toBeNull();
    expect(next!.getUTCMonth()).toBe(2); // March = index 2
    expect(next!.getUTCDate()).toBe(1);
  });

  it("treats DOW 7 as Sunday (same as 0)", () => {
    // 2026-01-04 is a Sunday
    const from = new Date("2026-01-01T00:00:00.000Z");
    const next0 = getNextCronTime("0 0 * * 0", from);
    const next7 = getNextCronTime("0 0 * * 7", from);
    expect(next0).not.toBeNull();
    expect(next7).not.toBeNull();
    expect(next0!.getTime()).toBe(next7!.getTime());
  });

  it("handles comma lists", () => {
    const from = new Date("2026-01-01T00:00:00.000Z");
    const next = getNextCronTime("0 6,12,18 * * *", from);
    expect(next).not.toBeNull();
    expect(next!.getUTCHours()).toBe(6);
  });

  it("handles range + step expressions", () => {
    // Every 10 minutes in the first half of each hour
    const from = new Date("2026-01-01T00:25:00.000Z");
    const next = getNextCronTime("0-30/10 * * * *", from);
    expect(next).not.toBeNull();
    expect(next!.getUTCMinutes()).toBe(30);
  });

  it("fires strictly after from, not at the same minute", () => {
    const from = new Date("2026-01-01T02:00:00.000Z");
    const next = getNextCronTime("0 2 * * *", from);
    expect(next).not.toBeNull();
    // Should be next day at 2am, not the same minute
    expect(next!.getTime()).toBeGreaterThan(from.getTime());
    expect(next!.getUTCDate()).toBe(2);
  });
});
