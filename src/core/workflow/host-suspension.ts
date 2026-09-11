import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";

export type ActiveClockObservation = {
  monotonicMs: number;
  wallMs: number;
  /** Linux CLOCK_BOOTTIME, which includes suspend unlike CLOCK_MONOTONIC. */
  bootMs?: number;
};

export type ActiveClock = {
  observe(): ActiveClockObservation;
  suspendedBetween(before: ActiveClockObservation, after: ActiveClockObservation): number;
};

/** Timer lateness is not sleep evidence. Only OS clock/power observations qualify. */
export const hostActiveClock: ActiveClock = {
  observe() {
    let bootMs: number | undefined;
    if (process.platform === "linux") {
      try {
        const seconds = Number(readFileSync("/proc/uptime", "utf8").split(" ")[0]);
        if (Number.isFinite(seconds)) bootMs = seconds * 1_000;
      } catch { /* Unavailable power evidence cannot establish suspension. */ }
    }
    return { monotonicMs: performance.now(), wallMs: Date.now(), bootMs };
  },
  suspendedBetween(before, after) {
    if (before.bootMs !== undefined && after.bootMs !== undefined) {
      const gap = after.bootMs - before.bootMs - (after.monotonicMs - before.monotonicMs);
      return gap > 1_000 ? gap : 0;
    }
    if (process.platform !== "darwin") return 0;
    try {
      // Kernel power timestamps are independent of the JS event loop. Read only
      // after a long gap; a stalled callback alone never subtracts runtime.
      const output = execFileSync("/usr/sbin/sysctl", ["-n", "kern.sleeptime", "kern.waketime"], {
        encoding: "utf8", timeout: 500, maxBuffer: 4_096, stdio: ["ignore", "pipe", "ignore"],
      });
      return darwinSuspendedMs(output, before.wallMs, after.wallMs);
    } catch { return 0; }
  },
};

/** Decode independent kernel sleep/wake observations, bounded to this interval. */
export function darwinSuspendedMs(output: string, beforeMs: number, afterMs: number): number {
  const times = [...output.matchAll(/sec\s*=\s*(\d+),\s*usec\s*=\s*(\d+)/g)]
    .map((match) => Number(match[1]) * 1_000 + Number(match[2]) / 1_000);
  if (times.length !== 2 || times.some((time) => !Number.isFinite(time))) return 0;
  const [sleep, wake] = times as [number, number];
  if (wake <= sleep || wake > afterMs || wake < beforeMs) return 0;
  return Math.max(0, wake - Math.max(sleep, beforeMs));
}
