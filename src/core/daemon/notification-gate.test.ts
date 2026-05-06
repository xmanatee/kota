import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "#core/events/event-bus.js";
import {
  isWithinQuietHours,
  msUntilQuietHoursEnd,
  NotificationGate,
  parseQuietHours,
  type QuietHoursConfig,
} from "./notification-gate.js";

function makeTime(h: number, m: number, s = 0, ms = 0): Date {
  const d = new Date(2024, 0, 15); // arbitrary Monday
  d.setHours(h, m, s, ms);
  return d;
}

describe("isWithinQuietHours", () => {
  it("midnight-spanning window: inside (after start)", () => {
    const config: QuietHoursConfig = { start: "22:00", end: "08:00" };
    expect(isWithinQuietHours(config, makeTime(23, 0))).toBe(true);
    expect(isWithinQuietHours(config, makeTime(22, 0))).toBe(true);
  });

  it("midnight-spanning window: inside (before end)", () => {
    const config: QuietHoursConfig = { start: "22:00", end: "08:00" };
    expect(isWithinQuietHours(config, makeTime(0, 0))).toBe(true);
    expect(isWithinQuietHours(config, makeTime(7, 59))).toBe(true);
  });

  it("midnight-spanning window: outside (between end and start)", () => {
    const config: QuietHoursConfig = { start: "22:00", end: "08:00" };
    expect(isWithinQuietHours(config, makeTime(8, 0))).toBe(false);
    expect(isWithinQuietHours(config, makeTime(12, 0))).toBe(false);
    expect(isWithinQuietHours(config, makeTime(21, 59))).toBe(false);
  });

  it("same-day window: inside", () => {
    const config: QuietHoursConfig = { start: "01:00", end: "06:00" };
    expect(isWithinQuietHours(config, makeTime(1, 0))).toBe(true);
    expect(isWithinQuietHours(config, makeTime(3, 30))).toBe(true);
    expect(isWithinQuietHours(config, makeTime(5, 59))).toBe(true);
  });

  it("same-day window: outside", () => {
    const config: QuietHoursConfig = { start: "01:00", end: "06:00" };
    expect(isWithinQuietHours(config, makeTime(0, 59))).toBe(false);
    expect(isWithinQuietHours(config, makeTime(6, 0))).toBe(false);
  });
});

describe("msUntilQuietHoursEnd", () => {
  it("returns ms until end time when end is later today", () => {
    const config: QuietHoursConfig = { start: "22:00", end: "08:00" };
    // 06:00 exactly, end is 08:00 — 2 hours away
    const now = makeTime(6, 0, 0, 0);
    const ms = msUntilQuietHoursEnd(config, now);
    expect(ms).toBe(2 * 60 * 60 * 1000);
  });

  it("returns ms until end time crossing midnight", () => {
    const config: QuietHoursConfig = { start: "22:00", end: "08:00" };
    // 23:00 — end is next day at 08:00 — 9 hours away
    const now = makeTime(23, 0, 0, 0);
    const ms = msUntilQuietHoursEnd(config, now);
    expect(ms).toBe(9 * 60 * 60 * 1000);
  });

  it("accounts for seconds elapsed in the current minute", () => {
    const config: QuietHoursConfig = { start: "22:00", end: "08:00" };
    // 07:00:30 — 30 seconds into the minute, end is 08:00 = 60 minutes away
    const now = makeTime(7, 0, 30, 0);
    const ms = msUntilQuietHoursEnd(config, now);
    // 60 mins * 60000 - 30000 = 3,600,000 - 30,000 = 3,570,000
    expect(ms).toBe(60 * 60 * 1000 - 30 * 1000);
  });
});

describe("parseQuietHours", () => {
  it("accepts valid midnight-spanning config", () => {
    const r = parseQuietHours({ start: "22:00", end: "08:00" });
    expect(r).toEqual({ ok: true, config: { start: "22:00", end: "08:00" } });
  });

  it("accepts valid same-day config and preserves allowCritical", () => {
    const r = parseQuietHours({ start: "01:00", end: "06:00", allowCritical: false });
    expect(r).toEqual({
      ok: true,
      config: { start: "01:00", end: "06:00", allowCritical: false },
    });
  });

  it("rejects non-object", () => {
    expect(parseQuietHours(null).ok).toBe(false);
    expect(parseQuietHours("22:00").ok).toBe(false);
  });

  it("rejects bad HH:MM format", () => {
    expect(parseQuietHours({ start: "9:00", end: "08:00" }).ok).toBe(false);
    expect(parseQuietHours({ start: "22:00", end: "8pm" }).ok).toBe(false);
  });

  it("rejects out-of-range values", () => {
    expect(parseQuietHours({ start: "25:00", end: "08:00" }).ok).toBe(false);
    expect(parseQuietHours({ start: "22:00", end: "08:60" }).ok).toBe(false);
  });

  it("rejects equal start and end", () => {
    expect(parseQuietHours({ start: "08:00", end: "08:00" }).ok).toBe(false);
  });

  it("rejects non-boolean allowCritical", () => {
    expect(parseQuietHours({ start: "22:00", end: "08:00", allowCritical: 1 }).ok).toBe(false);
  });
});

describe("NotificationGate", () => {
  let bus: EventBus;
  let received: Array<{ event: string; payload: Record<string, unknown> }>;

  beforeEach(() => {
    vi.useFakeTimers();
    bus = new EventBus();
    received = [];
    bus.on("workflow.attention.digest", (p) => received.push({ event: "workflow.attention.digest", payload: p }));
    bus.on("workflow.failure.alert", (p) => received.push({ event: "workflow.failure.alert", payload: p }));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("passes through events when outside quiet hours", () => {
    // 12:00 — outside 22:00–08:00 quiet hours
    vi.setSystemTime(makeTime(12, 0, 0, 0));
    const config: QuietHoursConfig = { start: "22:00", end: "08:00" };
    const gate = new NotificationGate(bus, config);

    bus.emit("workflow.attention.digest", { items: [], text: "hello" });
    expect(received).toHaveLength(1);
    expect(received[0]?.event).toBe("workflow.attention.digest");

    gate.dispose();
  });

  it("suppresses gated events during quiet hours", () => {
    // 23:00 — inside 22:00–08:00 quiet hours
    vi.setSystemTime(makeTime(23, 0, 0, 0));
    const config: QuietHoursConfig = { start: "22:00", end: "08:00" };
    const gate = new NotificationGate(bus, config);

    bus.emit("workflow.attention.digest", { items: [], text: "held" });
    expect(received).toHaveLength(0);

    gate.dispose();
  });

  it("suppresses workflow.daily.digest during quiet hours and releases on window end", () => {
    vi.setSystemTime(makeTime(23, 0, 0, 0));
    const config: QuietHoursConfig = { start: "22:00", end: "08:00" };
    bus.on("workflow.daily.digest", (p) =>
      received.push({ event: "workflow.daily.digest", payload: p }),
    );
    const gate = new NotificationGate(bus, config);

    bus.emit("workflow.daily.digest", {
      windowStartedAt: "x",
      windowEndedAt: "y",
      text: "Daily digest body",
      quiet: false,
    });
    expect(received).toHaveLength(0);

    vi.advanceTimersByTime(9 * 60 * 60 * 1000 + 1000);
    // Released as a single batched attention digest entry that includes the
    // held daily-digest text so the operator does not lose the body.
    expect(received).toHaveLength(1);
    expect(received[0]?.event).toBe("workflow.attention.digest");
    const releasedText = (received[0]?.payload as { text: string }).text;
    expect(releasedText).toContain("Daily digest body");

    gate.dispose();
  });

  it("releases held events as a single digest when window ends", () => {
    // 23:00 — 9 hours until 08:00
    vi.setSystemTime(makeTime(23, 0, 0, 0));
    const config: QuietHoursConfig = { start: "22:00", end: "08:00" };
    const gate = new NotificationGate(bus, config);

    bus.emit("workflow.attention.digest", { items: [{ label: "a", detail: "first" }], text: "first" });
    bus.emit("workflow.attention.digest", { items: [{ label: "b", detail: "second" }], text: "second" });
    expect(received).toHaveLength(0);

    // Advance past end of quiet hours (9 hours)
    vi.advanceTimersByTime(9 * 60 * 60 * 1000 + 1000);

    expect(received).toHaveLength(1);
    expect(received[0]?.event).toBe("workflow.attention.digest");
    const digest = received[0]?.payload as { items: unknown[]; text: string };
    expect(digest.items).toHaveLength(2);
    expect(digest.text).toContain("2 held notification");

    gate.dispose();
  });

  it("passes critical events through during quiet hours (allowCritical default)", () => {
    vi.setSystemTime(makeTime(23, 0, 0, 0));
    const config: QuietHoursConfig = { start: "22:00", end: "08:00" };
    const gate = new NotificationGate(bus, config);

    bus.emit("workflow.failure.alert", {
      workflow: "builder",
      runId: "abc",
      status: "failed",
      durationMs: 100,
      errorSummary: "oops",
      text: "Builder failed",
    });
    expect(received).toHaveLength(1);
    expect(received[0]?.event).toBe("workflow.failure.alert");

    gate.dispose();
  });

  it("does not schedule a second timer for additional held events", () => {
    vi.setSystemTime(makeTime(23, 0, 0, 0));
    const config: QuietHoursConfig = { start: "22:00", end: "08:00" };
    const gate = new NotificationGate(bus, config);

    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    bus.emit("workflow.attention.digest", { items: [], text: "first" });
    bus.emit("workflow.attention.digest", { items: [], text: "second" });
    // Only one timer should be set
    expect(setTimeoutSpy).toHaveBeenCalledTimes(1);

    gate.dispose();
  });

  it("dispose unregisters the middleware and discards buffer", () => {
    vi.setSystemTime(makeTime(23, 0, 0, 0));
    const config: QuietHoursConfig = { start: "22:00", end: "08:00" };
    const gate = new NotificationGate(bus, config);

    bus.emit("workflow.attention.digest", { items: [], text: "held" });
    expect(received).toHaveLength(0);

    gate.dispose();

    // After dispose, emit goes through directly
    bus.emit("workflow.attention.digest", { items: [], text: "after dispose" });
    expect(received).toHaveLength(1);

    // Timer should not fire buffered events after dispose
    vi.advanceTimersByTime(10 * 60 * 60 * 1000);
    expect(received).toHaveLength(1); // no additional batched digest
  });

  it("midnight-spanning window: correctly identifies inside/outside at boundary", () => {
    // 08:00 exactly — this is the end of quiet hours, should be OUTSIDE
    vi.setSystemTime(makeTime(8, 0, 0, 0));
    const config: QuietHoursConfig = { start: "22:00", end: "08:00" };
    const gate = new NotificationGate(bus, config);

    bus.emit("workflow.attention.digest", { items: [], text: "at boundary" });
    expect(received).toHaveLength(1); // passed through, not held

    gate.dispose();
  });
});
