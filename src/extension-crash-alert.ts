import type { EventBus } from "./event-bus.js";

const DEFAULT_THRESHOLD = 3;
const DEFAULT_WINDOW_MS = 600_000;

export type ExtensionCrashAlertOptions = {
  /** Number of restarts within windowMs that triggers an alert. Default: 3. */
  crashAlertThreshold?: number;
  /** Rolling window in ms for counting restarts. Default: 600000 (10 minutes). */
  crashAlertWindowMs?: number;
};

/**
 * Subscribe to extension restart events and emit `extension.crash.alert` when a
 * foreign extension's restart count exceeds the threshold within a rolling window.
 * At most one alert fires per extension per window (cooldown = windowMs).
 */
export function subscribeExtensionCrashAlert(
  bus: EventBus,
  opts?: ExtensionCrashAlertOptions,
): () => void {
  const threshold = opts?.crashAlertThreshold ?? DEFAULT_THRESHOLD;
  const windowMs = opts?.crashAlertWindowMs ?? DEFAULT_WINDOW_MS;

  const restartTimes = new Map<string, number[]>();
  const lastAlertAt = new Map<string, number>();

  return bus.on("extension.restarted", ({ name }) => {
    const now = Date.now();

    const windowStart = now - windowMs;
    const times = (restartTimes.get(name) ?? []).filter((t) => t >= windowStart);
    times.push(now);
    restartTimes.set(name, times);

    if (times.length < threshold) return;

    const lastAlert = lastAlertAt.get(name);
    if (lastAlert !== undefined && now - lastAlert < windowMs) return;
    lastAlertAt.set(name, now);

    const durationMin = Math.round(windowMs / 60_000);
    const text = `Extension crash loop: *${name}* restarted ${times.length} times in the last ${durationMin}m`;
    bus.emit("extension.crash.alert", {
      name,
      restartCount: times.length,
      windowMs,
      text,
    });
  });
}
