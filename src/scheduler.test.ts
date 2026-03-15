import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseRepeat, parseTime, resetScheduler, Scheduler } from "./scheduler.js";

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
});

describe("Scheduler", () => {
  let scheduler: Scheduler;

  beforeEach(() => {
    scheduler = new Scheduler("/test", null); // in-memory mode
  });

  afterEach(() => {
    scheduler.stopTimer();
    resetScheduler();
  });

  it("adds and retrieves an item", () => {
    const trigger = new Date(Date.now() + 60_000);
    const item = scheduler.add("Test reminder", trigger);
    expect(item.id).toBe(1);
    expect(item.description).toBe("Test reminder");
    expect(item.status).toBe("pending");
    expect(scheduler.count()).toBe(1);
  });

  it("getDue returns items past their trigger time", () => {
    const past = new Date(Date.now() - 60_000);
    const future = new Date(Date.now() + 3_600_000);
    scheduler.add("Past item", past);
    scheduler.add("Future item", future);

    const due = scheduler.getDue();
    expect(due).toHaveLength(1);
    expect(due[0].description).toBe("Past item");
  });

  it("markFired changes status for one-shot items", () => {
    const past = new Date(Date.now() - 60_000);
    const item = scheduler.add("One-shot", past);
    scheduler.markFired(item.id);

    const updated = scheduler.get(item.id)!;
    expect(updated.status).toBe("fired");
    expect(updated.firedAt).toBeDefined();
  });

  it("markFired reschedules repeating items", () => {
    const past = new Date(Date.now() - 60_000);
    const item = scheduler.add("Repeating", past, {
      repeatMs: 3_600_000,
      repeatLabel: "hourly",
    });
    scheduler.markFired(item.id);

    const updated = scheduler.get(item.id)!;
    expect(updated.status).toBe("pending"); // still pending
    expect(new Date(updated.triggerAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("cancel marks item as cancelled", () => {
    const trigger = new Date(Date.now() + 60_000);
    const item = scheduler.add("Cancellable", trigger);
    expect(scheduler.cancel(item.id)).toBe(true);
    expect(scheduler.get(item.id)!.status).toBe("cancelled");
    expect(scheduler.count()).toBe(0);
  });

  it("cancel returns false for non-existent item", () => {
    expect(scheduler.cancel(999)).toBe(false);
  });

  it("list returns all items", () => {
    scheduler.add("A", new Date(Date.now() + 60_000));
    scheduler.add("B", new Date(Date.now() + 120_000));
    expect(scheduler.list()).toHaveLength(2);
  });

  it("pending returns only pending items", () => {
    const past = new Date(Date.now() - 60_000);
    const future = new Date(Date.now() + 60_000);
    const item = scheduler.add("Past", past);
    scheduler.add("Future", future);
    scheduler.markFired(item.id);

    expect(scheduler.pending()).toHaveLength(1);
    expect(scheduler.pending()[0].description).toBe("Future");
  });

  it("getPendingSummary shows overdue and upcoming", () => {
    const past = new Date(Date.now() - 60_000);
    const future = new Date(Date.now() + 3_600_000);
    scheduler.add("Overdue task", past);
    scheduler.add("Future task", future);

    const summary = scheduler.getPendingSummary();
    expect(summary).toContain("OVERDUE");
    expect(summary).toContain("Overdue task");
    expect(summary).toContain("upcoming");
    expect(summary).toContain("Future task");
  });

  it("getPendingSummary returns null when empty", () => {
    expect(scheduler.getPendingSummary()).toBeNull();
  });

  it("startTimer calls onDue for past items", async () => {
    const past = new Date(Date.now() - 60_000);
    scheduler.add("Due now", past);

    const fired: string[] = [];
    scheduler.startTimer(50, (items) => {
      fired.push(...items.map((i) => i.description));
    });

    await new Promise((r) => setTimeout(r, 100));
    scheduler.stopTimer();

    expect(fired).toContain("Due now");
  });

  it("adds an item with an action", () => {
    const trigger = new Date(Date.now() + 60_000);
    const item = scheduler.add("Check weather", trigger, {
      action: "Search for weather in NYC and summarize",
    });
    expect(item.action).toBe("Search for weather in NYC and summarize");
    expect(item.description).toBe("Check weather");
    expect(item.status).toBe("pending");
  });

  it("adds an item with action and repeat", () => {
    const trigger = new Date(Date.now() + 60_000);
    const item = scheduler.add("Hourly report", trigger, {
      repeatMs: 3_600_000,
      repeatLabel: "hourly",
      action: "Generate status report",
    });
    expect(item.action).toBe("Generate status report");
    expect(item.repeatMs).toBe(3_600_000);
    expect(item.repeatLabel).toBe("hourly");
  });

  it("action persists through markFired for repeating items", () => {
    const past = new Date(Date.now() - 60_000);
    const item = scheduler.add("Recurring action", past, {
      repeatMs: 3_600_000,
      repeatLabel: "hourly",
      action: "Do the thing",
    });
    scheduler.markFired(item.id);

    const updated = scheduler.get(item.id)!;
    expect(updated.status).toBe("pending"); // still pending (repeating)
    expect(updated.action).toBe("Do the thing"); // action preserved
  });

  it("repeating items with past trigger advance to next future occurrence", () => {
    // Create an item that should have fired 5 intervals ago
    const past = new Date(Date.now() - 5 * 3_600_000);
    const item = scheduler.add("Hourly check", past, {
      repeatMs: 3_600_000,
      repeatLabel: "hourly",
    });
    scheduler.markFired(item.id);

    const updated = scheduler.get(item.id)!;
    const nextTrigger = new Date(updated.triggerAt).getTime();
    expect(nextTrigger).toBeGreaterThan(Date.now());
    // Should be within one interval of now
    expect(nextTrigger - Date.now()).toBeLessThanOrEqual(3_600_000);
  });
});
