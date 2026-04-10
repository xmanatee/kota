import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BusEvents } from "../events/event-bus.js";
import { EventBus } from "../events/event-bus.js";
import { subscribeModuleCrashAlert } from "./module-crash-alert.js";

function emitRestart(bus: EventBus, name: string, totalRestarts = 1) {
  bus.emit("module.restarted", { name, reason: "subprocess exited unexpectedly", totalRestarts });
}

describe("subscribeModuleCrashAlert", () => {
  let bus: EventBus;
  let alerts: BusEvents["module.crash.alert"][];
  let unsubscribe: () => void;

  beforeEach(() => {
    vi.useFakeTimers();
    bus = new EventBus();
    alerts = [];
    bus.on("module.crash.alert", (payload) => {
      alerts.push(payload);
    });
  });

  afterEach(() => {
    unsubscribe?.();
    vi.useRealTimers();
  });

  it("emits alert when restart count reaches threshold", () => {
    unsubscribe = subscribeModuleCrashAlert(bus, { crashAlertThreshold: 3, crashAlertWindowMs: 60_000 });
    emitRestart(bus, "my-ext", 1);
    emitRestart(bus, "my-ext", 2);
    expect(alerts).toHaveLength(0);
    emitRestart(bus, "my-ext", 3);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].name).toBe("my-ext");
    expect(alerts[0].restartCount).toBe(3);
    expect(alerts[0].text).toContain("my-ext");
    expect(alerts[0].text).toContain("3");
  });

  it("does not emit alert when restart count is below threshold", () => {
    unsubscribe = subscribeModuleCrashAlert(bus, { crashAlertThreshold: 5, crashAlertWindowMs: 60_000 });
    emitRestart(bus, "my-ext", 1);
    emitRestart(bus, "my-ext", 2);
    emitRestart(bus, "my-ext", 3);
    emitRestart(bus, "my-ext", 4);
    expect(alerts).toHaveLength(0);
  });

  it("cooldown prevents second alert within window", () => {
    unsubscribe = subscribeModuleCrashAlert(bus, { crashAlertThreshold: 2, crashAlertWindowMs: 60_000 });
    emitRestart(bus, "my-ext", 1);
    emitRestart(bus, "my-ext", 2);
    expect(alerts).toHaveLength(1);
    // More restarts within the window should not re-alert
    emitRestart(bus, "my-ext", 3);
    emitRestart(bus, "my-ext", 4);
    expect(alerts).toHaveLength(1);
  });

  it("fires again after cooldown window expires", () => {
    unsubscribe = subscribeModuleCrashAlert(bus, { crashAlertThreshold: 2, crashAlertWindowMs: 60_000 });
    emitRestart(bus, "my-ext", 1);
    emitRestart(bus, "my-ext", 2);
    expect(alerts).toHaveLength(1);

    // Advance time past the window
    vi.advanceTimersByTime(61_000);

    emitRestart(bus, "my-ext", 3);
    emitRestart(bus, "my-ext", 4);
    expect(alerts).toHaveLength(2);
  });

  it("uses default threshold of 3 and window of 10 minutes", () => {
    unsubscribe = subscribeModuleCrashAlert(bus);
    emitRestart(bus, "my-ext", 1);
    emitRestart(bus, "my-ext", 2);
    expect(alerts).toHaveLength(0);
    emitRestart(bus, "my-ext", 3);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].windowMs).toBe(600_000);
  });

  it("alert is per-module — one module does not suppress another", () => {
    unsubscribe = subscribeModuleCrashAlert(bus, { crashAlertThreshold: 2, crashAlertWindowMs: 60_000 });
    emitRestart(bus, "ext-a", 1);
    emitRestart(bus, "ext-a", 2);
    emitRestart(bus, "ext-b", 1);
    emitRestart(bus, "ext-b", 2);
    expect(alerts).toHaveLength(2);
    expect(alerts[0].name).toBe("ext-a");
    expect(alerts[1].name).toBe("ext-b");
  });

  it("restarts outside the rolling window are not counted", () => {
    unsubscribe = subscribeModuleCrashAlert(bus, { crashAlertThreshold: 3, crashAlertWindowMs: 60_000 });
    emitRestart(bus, "my-ext", 1);
    emitRestart(bus, "my-ext", 2);
    // Advance time so those restarts fall outside the window
    vi.advanceTimersByTime(61_000);
    emitRestart(bus, "my-ext", 3);
    // Only 1 restart is in window now, below threshold
    expect(alerts).toHaveLength(0);
    emitRestart(bus, "my-ext", 4);
    // 2 in window, still below threshold of 3
    expect(alerts).toHaveLength(0);
    emitRestart(bus, "my-ext", 5);
    // 3 in window, threshold reached
    expect(alerts).toHaveLength(1);
  });

  it("unsubscribes correctly", () => {
    unsubscribe = subscribeModuleCrashAlert(bus, { crashAlertThreshold: 2, crashAlertWindowMs: 60_000 });
    unsubscribe();
    emitRestart(bus, "my-ext", 1);
    emitRestart(bus, "my-ext", 2);
    expect(alerts).toHaveLength(0);
  });
});
