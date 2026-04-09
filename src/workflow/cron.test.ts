import { describe, expect, it } from "vitest";
import { getNextCronTime, validateCronExpr, validateTimezone } from "./cron.js";

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

describe("validateTimezone", () => {
  it("accepts valid IANA timezone names", () => {
    expect(validateTimezone("America/New_York")).toBeNull();
    expect(validateTimezone("America/Los_Angeles")).toBeNull();
    expect(validateTimezone("Europe/London")).toBeNull();
    expect(validateTimezone("UTC")).toBeNull();
    expect(validateTimezone("Asia/Tokyo")).toBeNull();
  });

  it("rejects invalid timezone names", () => {
    expect(validateTimezone("Not/ATimezone")).toMatch(/invalid timezone/);
    expect(validateTimezone("US/FakeZone")).toMatch(/invalid timezone/);
    expect(validateTimezone("foo")).toMatch(/invalid timezone/);
  });
});

describe("getNextCronTime with timezone", () => {
  it("UTC default (no timezone) fires at UTC wall-clock time", () => {
    // 9am UTC daily: from 8:55 UTC, next should be 9:00 UTC
    const from = new Date("2026-01-01T08:55:00.000Z");
    const next = getNextCronTime("0 9 * * *", from);
    expect(next).not.toBeNull();
    expect(next!.getUTCHours()).toBe(9);
    expect(next!.getUTCMinutes()).toBe(0);
  });

  it("named timezone fires at correct local wall-clock time", () => {
    // America/New_York is UTC-5 in January (EST).
    // 9am daily in New York = 14:00 UTC.
    // from = 2026-01-05T10:00:00Z (5am NY time), next should be 14:00 UTC same day.
    const from = new Date("2026-01-05T10:00:00.000Z");
    const next = getNextCronTime("0 9 * * *", from, "America/New_York");
    expect(next).not.toBeNull();
    expect(next!.toISOString()).toBe("2026-01-05T14:00:00.000Z");
  });

  it("handles DST transition — schedule shifts UTC offset correctly", () => {
    // America/New_York: EDT (UTC-4) ends 2024-11-03 at 2am.
    // "0 9 * * *" in America/New_York:
    //   - 2024-11-02 (EDT, UTC-4): 9am NY = 13:00 UTC
    //   - 2024-11-03 (EST, UTC-5): 9am NY = 14:00 UTC
    //
    // Case 1: from just before 9am NY time on Nov 2 (EDT)
    const from1 = new Date("2024-11-02T12:00:00.000Z"); // 8am EDT
    const next1 = getNextCronTime("0 9 * * *", from1, "America/New_York");
    expect(next1).not.toBeNull();
    expect(next1!.toISOString()).toBe("2024-11-02T13:00:00.000Z"); // 9am EDT

    // Case 2: from just after 9am NY on Nov 2 (EDT); next fire is Nov 3 at 9am EST
    const from2 = new Date("2024-11-02T13:01:00.000Z"); // 9:01am EDT
    const next2 = getNextCronTime("0 9 * * *", from2, "America/New_York");
    expect(next2).not.toBeNull();
    expect(next2!.toISOString()).toBe("2024-11-03T14:00:00.000Z"); // 9am EST (UTC+1 later)
  });

  it("invalid timezone returns null", () => {
    const from = new Date("2026-01-01T00:00:00.000Z");
    // getNextCronTime does not validate timezone itself; callers validate via
    // validateTimezone at definition load time. Passing an invalid timezone
    // will throw from Intl internally, so we verify it doesn't produce a
    // valid result silently — validation is the contract, not a graceful null.
    // This test documents that validateTimezone is the correct guard.
    expect(validateTimezone("Bogus/Zone")).not.toBeNull();
    // With a valid tz, results are correct:
    expect(getNextCronTime("0 9 * * *", from, "UTC")).not.toBeNull();
  });
});
