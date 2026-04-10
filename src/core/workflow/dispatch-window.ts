/**
 * Dispatch window — time-of-day and day-of-week restriction for autonomous workflow triggers.
 *
 * Affects `runtime.idle` (idle trigger) and `intervalMs` (interval trigger) only.
 * Cron, event, file-watch, and manual triggers are not affected.
 */

export type DispatchWindow = {
  /** Start of allowed window in local time, "HH:MM" (24-hour). */
  start: string;
  /** End of allowed window in local time, "HH:MM" (24-hour, exclusive). */
  end: string;
  /**
   * Days on which the window applies. Default: all days.
   * Accepted values: "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun"
   */
  days?: ("mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun")[];
};

const DAY_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
type DayName = (typeof DAY_NAMES)[number];

function parseHHMM(s: string): { h: number; m: number } {
  const parts = s.split(":");
  const h = parseInt(parts[0] ?? "0", 10);
  const m = parseInt(parts[1] ?? "0", 10);
  return { h, m };
}

function toMinutes(h: number, m: number): number {
  return h * 60 + m;
}

/** Returns true if `now` falls within the dispatch window. */
export function isWithinDispatchWindow(window: DispatchWindow, now = new Date()): boolean {
  const { h: sh, m: sm } = parseHHMM(window.start);
  const { h: eh, m: em } = parseHHMM(window.end);

  const days: readonly string[] = window.days ?? DAY_NAMES;
  const currentDay = DAY_NAMES[now.getDay()] as DayName;
  if (!days.includes(currentDay)) return false;

  const startMins = toMinutes(sh, sm);
  const endMins = toMinutes(eh, em);
  const nowMins = toMinutes(now.getHours(), now.getMinutes());

  return nowMins >= startMins && nowMins < endMins;
}

/**
 * Returns milliseconds until the dispatch window next opens.
 * Returns 0 if the window is currently open.
 */
export function msUntilDispatchWindowOpens(window: DispatchWindow, now = new Date()): number {
  if (isWithinDispatchWindow(window, now)) return 0;

  const { h: sh, m: sm } = parseHHMM(window.start);
  const startMins = toMinutes(sh, sm);
  const nowMins = toMinutes(now.getHours(), now.getMinutes());
  const days: readonly string[] = window.days ?? DAY_NAMES;

  for (let daysAhead = 0; daysAhead <= 7; daysAhead++) {
    const candidate = new Date(now);
    candidate.setDate(candidate.getDate() + daysAhead);
    const candidateDay = DAY_NAMES[candidate.getDay()];
    if (!days.includes(candidateDay)) continue;

    if (daysAhead === 0 && nowMins < startMins) {
      // Window opens later today
      const nextOpen = new Date(now);
      nextOpen.setHours(sh, sm, 0, 0);
      return nextOpen.getTime() - now.getTime();
    }

    if (daysAhead > 0) {
      // Window opens on a future day
      const nextOpen = new Date(candidate);
      nextOpen.setHours(sh, sm, 0, 0);
      return nextOpen.getTime() - now.getTime();
    }
  }

  // Fallback: 24 hours (should not be reached with a valid window)
  return 24 * 60 * 60 * 1000;
}

/** Validates a DispatchWindow config object. Returns an error message, or null if valid. */
export function validateDispatchWindow(w: unknown): string | null {
  if (typeof w !== "object" || w === null || Array.isArray(w)) {
    return "dispatchWindow must be an object";
  }
  const obj = w as Record<string, unknown>;

  if (typeof obj.start !== "string" || !/^\d{2}:\d{2}$/.test(obj.start)) {
    return 'dispatchWindow.start must be a string in "HH:MM" format';
  }
  if (typeof obj.end !== "string" || !/^\d{2}:\d{2}$/.test(obj.end)) {
    return 'dispatchWindow.end must be a string in "HH:MM" format';
  }

  const { h: sh, m: sm } = parseHHMM(obj.start);
  const { h: eh, m: em } = parseHHMM(obj.end);
  if (sh > 23 || sm > 59) return "dispatchWindow.start has invalid time value";
  if (eh > 23 || em > 59) return "dispatchWindow.end has invalid time value";
  if (toMinutes(sh, sm) >= toMinutes(eh, em)) {
    return "dispatchWindow.start must be earlier than dispatchWindow.end";
  }

  if (obj.days !== undefined) {
    if (!Array.isArray(obj.days)) return "dispatchWindow.days must be an array";
    const valid = new Set(DAY_NAMES as readonly string[]);
    for (const d of obj.days) {
      if (typeof d !== "string" || !valid.has(d)) {
        return `dispatchWindow.days contains invalid value "${d}". Allowed: mon, tue, wed, thu, fri, sat, sun`;
      }
    }
    if (obj.days.length === 0) return "dispatchWindow.days must not be empty";
  }

  return null;
}
