import { describe, expect, it } from "vitest";
import {
  matchesFilter,
  parseRepeat,
  parseTime,
  scopeHash,
} from "./schedule-parser.js";

describe("scopeHash", () => {
  it("returns a consistent hash for the same path", () => {
    const a = scopeHash("/home/user/project");
    const b = scopeHash("/home/user/project");
    expect(a).toBe(b);
  });

  it("returns different hashes for different paths", () => {
    const a = scopeHash("/home/user/scope-a");
    const b = scopeHash("/home/user/scope-b");
    expect(a).not.toBe(b);
  });

  it("returns a non-empty base-36 string", () => {
    const h = scopeHash("/test");
    expect(h.length).toBeGreaterThan(0);
    expect(/^[0-9a-z]+$/.test(h)).toBe(true);
  });

  it("handles empty string", () => {
    const h = scopeHash("");
    expect(h.length).toBeGreaterThan(0);
  });
});

describe("parseTime", () => {
  const now = new Date("2025-06-15T10:00:00Z");

  it("parses ISO datetime", () => {
    const result = parseTime("2025-06-15T14:00:00Z", now);
    expect(result).toEqual(new Date("2025-06-15T14:00:00Z"));
  });

  it("parses relative minutes", () => {
    const result = parseTime("in 30 minutes", now);
    expect(result!.getTime()).toBe(now.getTime() + 30 * 60_000);
  });

  it("parses relative hours", () => {
    const result = parseTime("in 2 hours", now);
    expect(result!.getTime()).toBe(now.getTime() + 2 * 3_600_000);
  });

  it("parses relative days", () => {
    const result = parseTime("in 1 day", now);
    expect(result!.getTime()).toBe(now.getTime() + 86_400_000);
  });

  it("parses 'at HH:MM' in the future", () => {
    const result = parseTime("at 15:00", now);
    expect(result).not.toBeNull();
    expect(result!.getHours()).toBe(15);
    expect(result!.getMinutes()).toBe(0);
  });

  it("parses 'at Npm' format", () => {
    const result = parseTime("at 3pm", now);
    expect(result).not.toBeNull();
    expect(result!.getHours()).toBe(15);
  });

  it("parses 'at Nam' format", () => {
    const result = parseTime("at 9am", now);
    expect(result).not.toBeNull();
    expect(result!.getHours()).toBe(9);
  });

  it("parses 'tomorrow at HH:MM'", () => {
    const result = parseTime("tomorrow at 9am", now);
    expect(result).not.toBeNull();
    expect(result!.getDate()).toBe(now.getDate() + 1);
    expect(result!.getHours()).toBe(9);
  });

  it.each([
    "next Friday at 9am", "not a time 3pm", "tomorrow nonsense 9am",
    "tomorrowish at 9am", "at 3pm Friday", "at 13pm", "at 0am", "at 00pm",
    "at 24:00", "at 123pm", "2026-02-30T09:00:00Z", "2025-02-29",
    "2026-04-31T09:00:00+01:00", "2026-00-15", "2026-13-01", "2026-01-00",
    "2026-09-15T24:00:00Z", "2026-09-15T09:60:00Z", "2026-09-15T09:00:60Z",
    "2026-09-15T09:00:00.0001Z", "2026-09-15T09:00:00+24:00",
    "noise 2026-09-15", "2026-09-15T09:00:00Z junk", "in 0.0001 seconds",
    "in 8640000000000 seconds", `in ${"9".repeat(310)} weeks`,
  ])("rejects incomplete, invalid or unrepresentable time %s", (expr) => {
    expect(parseTime(expr, now)).toBeNull();
  });

  it.each([
    ["2028-02-29T09:00:00Z", "2028-02-29T09:00:00.000Z"],
    ["2000-02-29T09:00:00.123+01:30", "2000-02-29T07:30:00.123Z"],
    ["2026-09-15", "2026-09-15T00:00:00.000Z"],
    ["2026-09-15T09:00Z", "2026-09-15T09:00:00.000Z"],
  ])("preserves ISO calendar and offset in %s", (expr, expected) => {
    expect(parseTime(expr, now)?.toISOString()).toBe(expected);
  });

  it("returns null for unparseable input", () => {
    expect(parseTime("whenever", now)).toBeNull();
    expect(parseTime("", now)).toBeNull();
  });

  it("returns null for invalid time values", () => {
    expect(parseTime("at 25:00", now)).toBeNull();
  });

  it("returns null for invalid minutes (at 12:60)", () => {
    expect(parseTime("at 12:60", now)).toBeNull();
  });

  it("handles 12am as midnight", () => {
    const result = parseTime("at 12am", now);
    expect(result).not.toBeNull();
    expect(result!.getHours()).toBe(0);
  });

  it("handles 12pm as noon", () => {
    const result = parseTime("at 12pm", now);
    expect(result).not.toBeNull();
    expect(result!.getHours()).toBe(12);
  });

  it("parses relative seconds", () => {
    const result = parseTime("in 30 seconds", now);
    expect(result!.getTime()).toBe(now.getTime() + 30_000);
  });

  it("parses relative weeks", () => {
    const result = parseTime("in 1 week", now);
    expect(result!.getTime()).toBe(now.getTime() + 604_800_000);
  });

  it("wraps past time to next day", () => {
    const result = parseTime("at 9:00", now);
    expect(result).not.toBeNull();
    expect(result!.getDate()).toBe(now.getDate() + 1);
  });

  it("preserves decimal millisecond boundaries", () => {
    expect(parseTime("in 1.001 seconds", now)?.getTime()).toBe(now.getTime() + 1001);
    expect(parseTime("in 0.99999999999999999 seconds", now)).toBeNull();
  });

  it("parses fractional relative values", () => {
    const result = parseTime("in 1.5 hours", now);
    expect(result!.getTime()).toBe(now.getTime() + 1.5 * 3_600_000);
  });

  it("trims whitespace", () => {
    const result = parseTime("  in 5 minutes  ", now);
    expect(result!.getTime()).toBe(now.getTime() + 5 * 60_000);
  });

  it("is case-insensitive", () => {
    const result = parseTime("In 10 Minutes", now);
    expect(result!.getTime()).toBe(now.getTime() + 10 * 60_000);
  });
});

describe("parseRepeat", () => {
  it("parses 'daily'", () => {
    const result = parseRepeat("daily");
    expect(result).toEqual({ ms: 86_400_000, label: "daily" });
  });

  it("parses 'hourly'", () => {
    const result = parseRepeat("hourly");
    expect(result).toEqual({ ms: 3_600_000, label: "hourly" });
  });

  it("parses 'every N units'", () => {
    const result = parseRepeat("every 30 minutes");
    expect(result).toEqual({ ms: 30 * 60_000, label: "every 30 minutes" });
  });

  it("parses 'every 2 hours'", () => {
    const result = parseRepeat("every 2 hours");
    expect(result).toEqual({ ms: 2 * 3_600_000, label: "every 2 hours" });
  });

  it("returns null for invalid input", () => {
    expect(parseRepeat("sometimes")).toBeNull();
  });

  it.each(["every 0 seconds", "every 0.999 seconds", "every 1.0001 seconds", "every 0.99999999999999999 seconds", "every 8640000000001 seconds", `every ${"9".repeat(310)} weeks`])("rejects unrepresentable or too-short recurrence %s", (expr) => {
    expect(parseRepeat(expr)).toBeNull();
  });

  it("preserves fractional units that represent whole milliseconds", () => {
    expect(parseRepeat("every 1.5 seconds")?.ms).toBe(1500);
    expect(parseRepeat("every 1.001 seconds")?.ms).toBe(1001);
    expect(parseRepeat("every 0.5 minutes")?.ms).toBe(30000);
    expect(parseRepeat("every 1 second")?.ms).toBe(1000);
  });

  it("parses weeks", () => {
    const result = parseRepeat("every 2 weeks");
    expect(result).toEqual({ ms: 2 * 604_800_000, label: "every 2 weeks" });
  });
});

describe("matchesFilter", () => {
  it("returns true when no filter is provided", () => {
    expect(matchesFilter({ key: "value" })).toBe(true);
    expect(matchesFilter({ key: "value" }, undefined)).toBe(true);
  });

  it("returns true when all filter keys match", () => {
    expect(
      matchesFilter({ label: "build", id: "42" }, { label: "build" }),
    ).toBe(true);
  });

  it("returns false when a filter key does not match", () => {
    expect(
      matchesFilter({ label: "test" }, { label: "build" }),
    ).toBe(false);
  });

  it("returns false when a filter key is missing from payload", () => {
    expect(matchesFilter({}, { label: "build" })).toBe(false);
  });

  it("coerces non-string payload values via String()", () => {
    expect(matchesFilter({ count: 42 }, { count: "42" })).toBe(true);
    expect(matchesFilter({ flag: true }, { flag: "true" })).toBe(true);
    expect(matchesFilter({ val: null }, { val: "null" })).toBe(true);
  });

  it("handles undefined payload values (coerced to 'undefined')", () => {
    expect(matchesFilter({ x: undefined }, { x: "undefined" })).toBe(true);
    expect(matchesFilter({ x: undefined }, { x: "" })).toBe(false);
  });

  it("matches empty filter (vacuously true)", () => {
    expect(matchesFilter({ key: "value" }, {})).toBe(true);
  });

  it("requires all filter keys to match (AND logic)", () => {
    const payload = { a: "1", b: "2", c: "3" };
    expect(matchesFilter(payload, { a: "1", b: "2" })).toBe(true);
    expect(matchesFilter(payload, { a: "1", b: "WRONG" })).toBe(false);
  });
});
