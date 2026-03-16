import { describe, expect, it } from "vitest";
import {
  formatRelative,
  matchesFilter,
  parseRepeat,
  parseTime,
  projectHash,
} from "./schedule-parser.js";

describe("projectHash", () => {
  it("returns a consistent hash for the same path", () => {
    const a = projectHash("/home/user/project");
    const b = projectHash("/home/user/project");
    expect(a).toBe(b);
  });

  it("returns different hashes for different paths", () => {
    const a = projectHash("/home/user/project-a");
    const b = projectHash("/home/user/project-b");
    expect(a).not.toBe(b);
  });

  it("returns a non-empty base-36 string", () => {
    const h = projectHash("/test");
    expect(h.length).toBeGreaterThan(0);
    expect(/^[0-9a-z]+$/.test(h)).toBe(true);
  });

  it("handles empty string", () => {
    const h = projectHash("");
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

  it("parses 'every 0 seconds' to 0ms (caller must validate)", () => {
    const result = parseRepeat("every 0 seconds");
    expect(result).toEqual({ ms: 0, label: "every 0 seconds" });
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

describe("formatRelative", () => {
  const now = new Date("2025-06-15T10:00:00Z");

  it("returns 'overdue' for past dates", () => {
    const past = new Date(now.getTime() - 60_000);
    expect(formatRelative(past, now)).toBe("overdue");
  });

  it("returns 'overdue' for equal dates", () => {
    expect(formatRelative(now, now)).toBe("overdue");
  });

  it("returns minutes for <60m", () => {
    const target = new Date(now.getTime() + 30 * 60_000);
    expect(formatRelative(target, now)).toBe("in 30m");
  });

  it("returns hours for 1-23h", () => {
    const target = new Date(now.getTime() + 3 * 3_600_000);
    expect(formatRelative(target, now)).toBe("in 3h");
  });

  it("returns days for 24h+", () => {
    const target = new Date(now.getTime() + 48 * 3_600_000);
    expect(formatRelative(target, now)).toBe("in 2d");
  });

  it("rounds to nearest minute", () => {
    const target = new Date(now.getTime() + 90_000); // 1.5 minutes
    expect(formatRelative(target, now)).toBe("in 2m");
  });

  it("boundary: exactly 60 minutes shows 1h", () => {
    const target = new Date(now.getTime() + 60 * 60_000);
    expect(formatRelative(target, now)).toBe("in 1h");
  });

  it("boundary: exactly 24 hours shows 1d", () => {
    const target = new Date(now.getTime() + 24 * 3_600_000);
    expect(formatRelative(target, now)).toBe("in 1d");
  });

  it("1 minute ahead", () => {
    const target = new Date(now.getTime() + 60_000);
    expect(formatRelative(target, now)).toBe("in 1m");
  });
});
