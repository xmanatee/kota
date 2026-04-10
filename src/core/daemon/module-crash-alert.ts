import type { EventBus } from "../events/event-bus.js";

const DEFAULT_THRESHOLD = 3;
const DEFAULT_WINDOW_MS = 600_000;

export type ModuleCrashAlertOptions = {
  /** Number of restarts within windowMs that triggers an alert. Default: 3. */
  crashAlertThreshold?: number;
  /** Rolling window in ms for counting restarts. Default: 600000 (10 minutes). */
  crashAlertWindowMs?: number;
};

/**
 * Subscribe to module restart events and emit `module.crash.alert` when a
 * foreign module's restart count exceeds the threshold within a rolling window.
 * At most one alert fires per module per window (cooldown = windowMs).
 */
export function subscribeModuleCrashAlert(
  bus: EventBus,
  opts?: ModuleCrashAlertOptions,
): () => void {
  const threshold = opts?.crashAlertThreshold ?? DEFAULT_THRESHOLD;
  const windowMs = opts?.crashAlertWindowMs ?? DEFAULT_WINDOW_MS;

  const restartTimes = new Map<string, number[]>();
  const lastAlertAt = new Map<string, number>();

  return bus.on("module.restarted", ({ name }) => {
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
    const text = `Module crash loop: *${name}* restarted ${times.length} times in the last ${durationMin}m`;
    bus.emit("module.crash.alert", {
      name,
      restartCount: times.length,
      windowMs,
      text,
    });
  });
}
