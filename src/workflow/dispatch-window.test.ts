import { describe, expect, it } from "vitest";
import {
  type DispatchWindow,
  isWithinDispatchWindow,
  msUntilDispatchWindowOpens,
  validateDispatchWindow,
} from "./dispatch-window.js";

/** Create a Date for a specific time on a Monday (2024-01-01 was a Monday). */
function makeTime(day: "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun", hh: number, mm: number): Date {
  const dayOffset = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
  // 2024-01-01 is a Monday; adjust by dayOffset[day] - 1 to get the right day
  const base = new Date(2024, 0, 1); // Monday Jan 1 2024
  const d = new Date(base);
  d.setDate(base.getDate() + (dayOffset[day] - 1));
  d.setHours(hh, mm, 0, 0);
  return d;
}

describe("isWithinDispatchWindow", () => {
  const window: DispatchWindow = { start: "09:00", end: "18:00", days: ["mon", "tue", "wed", "thu", "fri"] };

  it("returns true during window hours on a weekday", () => {
    expect(isWithinDispatchWindow(window, makeTime("mon", 9, 0))).toBe(true);
    expect(isWithinDispatchWindow(window, makeTime("mon", 12, 30))).toBe(true);
    expect(isWithinDispatchWindow(window, makeTime("fri", 17, 59))).toBe(true);
  });

  it("returns false before window start", () => {
    expect(isWithinDispatchWindow(window, makeTime("mon", 8, 59))).toBe(false);
    expect(isWithinDispatchWindow(window, makeTime("wed", 0, 0))).toBe(false);
  });

  it("returns false at or after window end (exclusive)", () => {
    expect(isWithinDispatchWindow(window, makeTime("mon", 18, 0))).toBe(false);
    expect(isWithinDispatchWindow(window, makeTime("tue", 23, 0))).toBe(false);
  });

  it("returns false on excluded days", () => {
    expect(isWithinDispatchWindow(window, makeTime("sat", 12, 0))).toBe(false);
    expect(isWithinDispatchWindow(window, makeTime("sun", 12, 0))).toBe(false);
  });

  it("returns true for all-day window with no days restriction", () => {
    const allDay: DispatchWindow = { start: "00:00", end: "23:59" };
    expect(isWithinDispatchWindow(allDay, makeTime("sat", 12, 0))).toBe(true);
    expect(isWithinDispatchWindow(allDay, makeTime("sun", 3, 0))).toBe(true);
  });
});

describe("msUntilDispatchWindowOpens", () => {
  const window: DispatchWindow = { start: "09:00", end: "18:00", days: ["mon", "tue", "wed", "thu", "fri"] };

  it("returns 0 when already within the window", () => {
    expect(msUntilDispatchWindowOpens(window, makeTime("mon", 12, 0))).toBe(0);
  });

  it("returns ms until window opens later today", () => {
    const now = makeTime("mon", 8, 0); // 8:00 Monday, window opens 9:00
    const ms = msUntilDispatchWindowOpens(window, now);
    expect(ms).toBe(60 * 60 * 1000); // exactly 1 hour
  });

  it("returns ms until next open day when today is excluded", () => {
    // Saturday — window applies Mon-Fri only, so next open is Monday 9:00
    const now = makeTime("sat", 12, 0);
    const ms = msUntilDispatchWindowOpens(window, now);
    expect(ms).toBeGreaterThan(0);
    // From Saturday 12:00 to Monday 9:00 is 1 day 21 hours = 165000000 ms
    expect(ms).toBe((1 * 24 + 21) * 60 * 60 * 1000);
  });

  it("returns ms until next day open when today's window has passed", () => {
    // Monday 19:00 — window closed for today, opens tomorrow (Tuesday 9:00)
    const now = makeTime("mon", 19, 0);
    const ms = msUntilDispatchWindowOpens(window, now);
    // Mon 19:00 -> Tue 9:00 = 14 hours
    expect(ms).toBe(14 * 60 * 60 * 1000);
  });
});

describe("validateDispatchWindow", () => {
  it("accepts valid window", () => {
    expect(validateDispatchWindow({ start: "09:00", end: "18:00" })).toBeNull();
    expect(validateDispatchWindow({ start: "00:00", end: "23:59", days: ["mon", "fri"] })).toBeNull();
  });

  it("rejects non-object", () => {
    expect(validateDispatchWindow(null)).not.toBeNull();
    expect(validateDispatchWindow("09:00")).not.toBeNull();
  });

  it("rejects bad start/end format", () => {
    expect(validateDispatchWindow({ start: "9:00", end: "18:00" })).not.toBeNull();
    expect(validateDispatchWindow({ start: "09:00", end: "6pm" })).not.toBeNull();
  });

  it("rejects start >= end", () => {
    expect(validateDispatchWindow({ start: "18:00", end: "09:00" })).not.toBeNull();
    expect(validateDispatchWindow({ start: "09:00", end: "09:00" })).not.toBeNull();
  });

  it("rejects invalid day values", () => {
    expect(validateDispatchWindow({ start: "09:00", end: "18:00", days: ["monday"] })).not.toBeNull();
  });

  it("rejects empty days array", () => {
    expect(validateDispatchWindow({ start: "09:00", end: "18:00", days: [] })).not.toBeNull();
  });
});
