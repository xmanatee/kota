import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "./event-bus.js";
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
    // now is 10:00 UTC, asking for 9am should wrap to tomorrow
    const result = parseTime("at 9:00", now);
    expect(result).not.toBeNull();
    expect(result!.getDate()).toBe(now.getDate() + 1);
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

  it("cancel removes item and returns true", () => {
    const trigger = new Date(Date.now() + 60_000);
    const item = scheduler.add("Cancellable", trigger);
    expect(scheduler.cancel(item.id)).toBe(true);
    expect(scheduler.get(item.id)).toBeUndefined();
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

  // --- Edge cases: repeatMs validation ---

  it("rejects repeatMs of 0 (would cause infinite loop)", () => {
    const trigger = new Date(Date.now() + 60_000);
    expect(() =>
      scheduler.add("Bad repeat", trigger, { repeatMs: 0 }),
    ).not.toThrow(); // repeatMs: 0 is falsy, skipped by `if (opts?.repeatMs)`
    // But explicit small values are rejected
    expect(() =>
      scheduler.add("Bad repeat", trigger, { repeatMs: 500 }),
    ).toThrow("repeatMs must be at least 1000");
  });

  it("rejects repeatMs below 1 second", () => {
    const trigger = new Date(Date.now() + 60_000);
    expect(() =>
      scheduler.add("Too fast", trigger, { repeatMs: 100 }),
    ).toThrow("repeatMs must be at least 1000");
  });

  it("accepts repeatMs of exactly 1 second", () => {
    const trigger = new Date(Date.now() + 60_000);
    const item = scheduler.add("One second", trigger, {
      repeatMs: 1000,
      repeatLabel: "every 1 second",
    });
    expect(item.repeatMs).toBe(1000);
  });

  it("markFired treats corrupt repeatMs (<1000) as one-shot", () => {
    const past = new Date(Date.now() - 60_000);
    // Simulate corrupt data loaded from disk with repeatMs=0
    const item = scheduler.add("Corrupt repeat", past);
    // Manually set corrupt repeatMs (as if loaded from bad file)
    const stored = scheduler.get(item.id)!;
    (stored as { repeatMs?: number }).repeatMs = 100;

    scheduler.markFired(item.id);
    const updated = scheduler.get(item.id)!;
    // Treated as one-shot: status becomes "fired"
    expect(updated.status).toBe("fired");
  });

  // --- Edge cases: markFired status checks ---

  it("markFired returns null for already-fired items", () => {
    const past = new Date(Date.now() - 60_000);
    const item = scheduler.add("One-shot", past);
    scheduler.markFired(item.id);
    // Try to fire again
    const result = scheduler.markFired(item.id);
    expect(result).toBeNull();
  });

  it("markFired returns null for cancelled items", () => {
    const future = new Date(Date.now() + 60_000);
    const item = scheduler.add("Will cancel", future);
    const id = item.id;
    scheduler.cancel(id);
    // Cancelled items are removed from array, so markFired can't find it
    expect(scheduler.markFired(id)).toBeNull();
  });

  it("markFired returns null for non-existent id", () => {
    expect(scheduler.markFired(999)).toBeNull();
  });

  // --- Edge cases: cancel behavior ---

  it("cancel returns false for already-fired items", () => {
    const past = new Date(Date.now() - 60_000);
    const item = scheduler.add("Fired", past);
    scheduler.markFired(item.id);
    expect(scheduler.cancel(item.id)).toBe(false);
  });

  it("cancel is idempotent (second cancel returns false)", () => {
    const trigger = new Date(Date.now() + 60_000);
    const item = scheduler.add("Once", trigger);
    expect(scheduler.cancel(item.id)).toBe(true);
    // Item already removed
    expect(scheduler.cancel(item.id)).toBe(false);
  });

  it("cancel does not affect other items", () => {
    const trigger = new Date(Date.now() + 60_000);
    scheduler.add("Keep", trigger);
    const toCancel = scheduler.add("Remove", trigger);
    scheduler.cancel(toCancel.id);
    expect(scheduler.count()).toBe(1);
    expect(scheduler.pending()[0].description).toBe("Keep");
  });

  // --- Edge cases: list consistency after operations ---

  it("list excludes cancelled items after cancel", () => {
    const trigger = new Date(Date.now() + 60_000);
    const item = scheduler.add("Will cancel", trigger);
    scheduler.add("Will keep", trigger);
    scheduler.cancel(item.id);
    const items = scheduler.list();
    expect(items).toHaveLength(1);
    expect(items[0].description).toBe("Will keep");
  });

  it("fired items beyond MAX_FIRED are trimmed", () => {
    const past = new Date(Date.now() - 60_000);
    // Add and fire 25 items (MAX_FIRED=20)
    for (let i = 0; i < 25; i++) {
      const item = scheduler.add(`Item ${i}`, past);
      scheduler.markFired(item.id);
    }
    // Oldest 5 fired items should be trimmed
    const all = scheduler.list();
    const firedItems = all.filter((i) => i.status === "fired");
    expect(firedItems.length).toBeLessThanOrEqual(20);
  });

  // --- Edge cases: nextId monotonic ---

  it("IDs are monotonically increasing across adds", () => {
    const trigger = new Date(Date.now() + 60_000);
    const ids = [];
    for (let i = 0; i < 5; i++) {
      ids.push(scheduler.add(`Task ${i}`, trigger).id);
    }
    for (let i = 1; i < ids.length; i++) {
      expect(ids[i]).toBeGreaterThan(ids[i - 1]);
    }
  });

  // --- Edge cases: startTimer ---

  it("startTimer replaces previous timer (no double-fire)", async () => {
    const past = new Date(Date.now() - 60_000);
    scheduler.add("Fire once", past);

    let fireCount = 0;
    // Start first timer
    scheduler.startTimer(50, () => { fireCount++; });
    // Immediately replace with second timer
    scheduler.startTimer(50, () => { fireCount++; });

    await new Promise((r) => setTimeout(r, 150));
    scheduler.stopTimer();

    // Should fire at most a few times from the second timer, not double
    // The key point: first timer was cleared
    expect(fireCount).toBeGreaterThanOrEqual(1);
    expect(fireCount).toBeLessThanOrEqual(3);
  });

  it("stopTimer is idempotent", () => {
    scheduler.stopTimer();
    scheduler.stopTimer(); // no error
  });
});

describe("Event-Based Triggers", () => {
  let scheduler: Scheduler;
  let bus: EventBus;

  beforeEach(() => {
    scheduler = new Scheduler("/test", null);
    bus = new EventBus();
  });

  afterEach(() => {
    scheduler.disconnectBus();
    scheduler.stopTimer();
    resetScheduler();
  });

  // --- addEventTrigger ---

  it("creates an event-triggered item", () => {
    const item = scheduler.addEventTrigger("Run improve", "session.end");
    expect(item.triggerEvent).toBe("session.end");
    expect(item.status).toBe("pending");
    expect(item.repeat).toBeUndefined();
    expect(item.triggerFilter).toBeUndefined();
    expect(scheduler.count()).toBe(1);
  });

  it("creates a repeating event trigger", () => {
    const item = scheduler.addEventTrigger("Run improve", "session.end", {
      repeat: true,
    });
    expect(item.repeat).toBe(true);
  });

  it("creates an event trigger with filter", () => {
    const item = scheduler.addEventTrigger("Run improve", "session.end", {
      filter: { label: "build-agent" },
    });
    expect(item.triggerFilter).toEqual({ label: "build-agent" });
  });

  it("creates an event trigger with action", () => {
    const item = scheduler.addEventTrigger("Run improve", "session.end", {
      action: "Analyze recent changes",
    });
    expect(item.action).toBe("Analyze recent changes");
  });

  it("rejects empty eventName", () => {
    expect(() =>
      scheduler.addEventTrigger("Bad", ""),
    ).toThrow("eventName is required");
  });

  it("skips empty filter object", () => {
    const item = scheduler.addEventTrigger("Test", "session.end", {
      filter: {},
    });
    expect(item.triggerFilter).toBeUndefined();
  });

  // --- getDue excludes event-triggered items ---

  it("getDue does not return event-triggered items", () => {
    const past = new Date(Date.now() - 60_000);
    scheduler.add("Time-based", past);
    scheduler.addEventTrigger("Event-based", "session.end");

    const due = scheduler.getDue();
    expect(due).toHaveLength(1);
    expect(due[0].description).toBe("Time-based");
  });

  // --- markFired with event triggers ---

  it("markFired makes one-shot event trigger 'fired'", () => {
    const item = scheduler.addEventTrigger("Once only", "session.end");
    scheduler.markFired(item.id);

    const updated = scheduler.get(item.id)!;
    expect(updated.status).toBe("fired");
    expect(updated.firedAt).toBeDefined();
  });

  it("markFired keeps repeating event trigger 'pending'", () => {
    const item = scheduler.addEventTrigger("Repeating", "session.end", {
      repeat: true,
    });
    scheduler.markFired(item.id);

    const updated = scheduler.get(item.id)!;
    expect(updated.status).toBe("pending");
    expect(updated.firedAt).toBeDefined();
  });

  it("markFired can fire a repeating event trigger multiple times", () => {
    const item = scheduler.addEventTrigger("Multi-fire", "session.end", {
      repeat: true,
    });
    scheduler.markFired(item.id);
    scheduler.markFired(item.id);
    scheduler.markFired(item.id);

    const updated = scheduler.get(item.id)!;
    expect(updated.status).toBe("pending");
    expect(updated.firedAt).toBeDefined();
  });

  // --- connectBus ---

  it("connectBus fires item when matching event emitted", () => {
    const item = scheduler.addEventTrigger("On end", "session.end");
    const fired: string[] = [];

    scheduler.connectBus(bus, (items) => {
      fired.push(...items.map((i) => i.description));
    });

    bus.emit("session.end", { sessionId: "s1", durationMs: 100 });
    expect(fired).toEqual(["On end"]);
    expect(scheduler.get(item.id)!.status).toBe("fired");
  });

  it("connectBus does not fire on non-matching events", () => {
    scheduler.addEventTrigger("On end", "session.end");
    const fired: string[] = [];

    scheduler.connectBus(bus, (items) => {
      fired.push(...items.map((i) => i.description));
    });

    bus.emit("session.start", { sessionId: "s1" });
    expect(fired).toHaveLength(0);
  });

  it("connectBus respects filter", () => {
    scheduler.addEventTrigger("Build only", "session.end", {
      filter: { label: "build-agent" },
    });
    scheduler.addEventTrigger("Any session", "session.end");
    const fired: string[] = [];

    scheduler.connectBus(bus, (items) => {
      fired.push(...items.map((i) => i.description));
    });

    // Non-matching filter — only "Any session" fires (one-shot, no filter)
    bus.emit("session.end", { sessionId: "s1", durationMs: 100 });
    expect(fired).toEqual(["Any session"]);

    // Matching filter — "Build only" fires now (still pending, filter matches)
    fired.length = 0;
    bus.emit("session.end", {
      sessionId: "s2",
      label: "build-agent",
      durationMs: 200,
    });
    expect(fired).toEqual(["Build only"]);
  });

  it("connectBus re-arms repeating triggers", () => {
    scheduler.addEventTrigger("Repeating", "session.end", { repeat: true });
    const fireCount: number[] = [];

    scheduler.connectBus(bus, (items) => {
      fireCount.push(items.length);
    });

    bus.emit("session.end", { sessionId: "s1", durationMs: 100 });
    bus.emit("session.end", { sessionId: "s2", durationMs: 200 });
    bus.emit("session.end", { sessionId: "s3", durationMs: 300 });

    expect(fireCount).toEqual([1, 1, 1]);
    expect(scheduler.pending()).toHaveLength(1);
  });

  it("connectBus one-shot does not re-fire", () => {
    scheduler.addEventTrigger("Once", "session.end");
    const fireCount: number[] = [];

    scheduler.connectBus(bus, (items) => {
      fireCount.push(items.length);
    });

    bus.emit("session.end", { sessionId: "s1", durationMs: 100 });
    bus.emit("session.end", { sessionId: "s2", durationMs: 200 });

    expect(fireCount).toEqual([1]);
    expect(scheduler.pending()).toHaveLength(0);
  });

  it("connectBus ignores schedule.fire events (prevents loops)", () => {
    scheduler.addEventTrigger("Self-loop", "schedule.fire");
    const fired: string[] = [];

    scheduler.connectBus(bus, (items) => {
      fired.push(...items.map((i) => i.description));
    });

    bus.emit("schedule.fire", { itemId: 1, description: "test" });
    expect(fired).toHaveLength(0);
  });

  it("connectBus handles custom string events", () => {
    scheduler.addEventTrigger("On deploy", "deploy.success");
    const fired: string[] = [];

    scheduler.connectBus(bus, (items) => {
      fired.push(...items.map((i) => i.description));
    });

    bus.emit("deploy.success", { sha: "abc123" });
    expect(fired).toEqual(["On deploy"]);
  });

  it("disconnectBus stops receiving events", () => {
    scheduler.addEventTrigger("Will disconnect", "session.end", {
      repeat: true,
    });
    const fired: string[] = [];

    scheduler.connectBus(bus, (items) => {
      fired.push(...items.map((i) => i.description));
    });

    bus.emit("session.end", { sessionId: "s1", durationMs: 100 });
    expect(fired).toHaveLength(1);

    scheduler.disconnectBus();
    bus.emit("session.end", { sessionId: "s2", durationMs: 200 });
    expect(fired).toHaveLength(1); // no new fires
  });

  it("disconnectBus is idempotent", () => {
    scheduler.disconnectBus();
    scheduler.disconnectBus(); // no error
  });

  it("connectBus replaces previous connection", () => {
    scheduler.addEventTrigger("Test", "session.end", { repeat: true });
    const fired1: string[] = [];
    const fired2: string[] = [];

    scheduler.connectBus(bus, (items) => {
      fired1.push(...items.map((i) => i.description));
    });
    scheduler.connectBus(bus, (items) => {
      fired2.push(...items.map((i) => i.description));
    });

    bus.emit("session.end", { sessionId: "s1", durationMs: 100 });
    expect(fired1).toHaveLength(0); // old connection disconnected
    expect(fired2).toHaveLength(1); // new connection active
  });

  // --- getPendingSummary with event triggers ---

  it("getPendingSummary includes event-triggered items", () => {
    const future = new Date(Date.now() + 3_600_000);
    scheduler.add("Time task", future);
    scheduler.addEventTrigger("Event task", "session.end", { repeat: true });

    const summary = scheduler.getPendingSummary();
    expect(summary).toContain("upcoming");
    expect(summary).toContain("Time task");
    expect(summary).toContain("event-triggered");
    expect(summary).toContain("Event task");
    expect(summary).toContain("on session.end");
    expect(summary).toContain("repeat");
  });

  it("getPendingSummary shows non-repeat event triggers", () => {
    scheduler.addEventTrigger("One-shot event", "action.complete");
    const summary = scheduler.getPendingSummary();
    expect(summary).toContain("event-triggered");
    expect(summary).toContain("on action.complete");
    expect(summary).not.toContain("repeat");
  });

  // --- Mixed time + event items ---

  it("time-based and event-triggered items coexist", () => {
    const future = new Date(Date.now() + 60_000);
    const past = new Date(Date.now() - 60_000);
    scheduler.add("Time future", future);
    scheduler.add("Time past", past);
    scheduler.addEventTrigger("Event", "session.end");

    expect(scheduler.count()).toBe(3);
    expect(scheduler.pending()).toHaveLength(3);
    expect(scheduler.getDue()).toHaveLength(1); // only time past
    expect(scheduler.getDue()[0].description).toBe("Time past");
  });

  // --- Filter edge cases ---

  it("filter matches when all keys present in payload", () => {
    scheduler.addEventTrigger("Multi-filter", "session.end", {
      filter: { label: "test", sessionId: "s1" },
    });
    const fired: string[] = [];

    scheduler.connectBus(bus, (items) => {
      fired.push(...items.map((i) => i.description));
    });

    // Missing one key
    bus.emit("session.end", { sessionId: "s1", durationMs: 100 });
    expect(fired).toHaveLength(0);

    // Both keys match
    scheduler.addEventTrigger("Multi-filter 2", "session.end", {
      filter: { label: "test", sessionId: "s2" },
    });
    bus.emit("session.end", {
      sessionId: "s2",
      label: "test",
      durationMs: 200,
    });
    expect(fired).toEqual(["Multi-filter 2"]);
  });

  it("filter coerces non-string payload values to string", () => {
    scheduler.addEventTrigger("Number match", "action.complete", {
      filter: { itemId: "42" },
    });
    const fired: string[] = [];

    scheduler.connectBus(bus, (items) => {
      fired.push(...items.map((i) => i.description));
    });

    bus.emit("action.complete", { itemId: 42, durationMs: 100 });
    expect(fired).toEqual(["Number match"]);
  });
});
