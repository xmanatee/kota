/**
 * Pure parsing, formatting, and type definitions for the scheduler.
 *
 * Extracted from scheduler.ts so parsing logic is independently
 * testable and reusable without importing the Scheduler class.
 */

import { scopeStorageIdentity } from "./scope-storage-identity.js";

export type ScheduledItem = {
  id: number;
  description: string;
  triggerAt: string; // ISO datetime
  repeatMs?: number;
  repeatLabel?: string;
  status: "pending" | "fired" | "cancelled";
  created: string;
  firedAt?: string;
  /** Event name that triggers this item (e.g., "session.end"). */
  triggerEvent?: string;
  /** Optional payload filter — all keys must match for the event to trigger. */
  triggerFilter?: Record<string, string>;
  /** For event triggers: re-arm after firing (stay pending). */
  repeat?: boolean;
};


/**
 * Deterministic hash for project-scoping storage files.
 * Used by TaskStore and the one-way legacy reminder import.
 */
export function scopeHash(path: string): string {
  const identity = scopeStorageIdentity(path);
  let h = 5381;
  for (let i = 0; i < identity.length; i++) {
    h = ((h << 5) + h + identity.charCodeAt(i)) >>> 0;
  }
  return h.toString(36);
}

/** Parse natural time expressions into an absolute Date. */
export function parseTime(expr: string, now?: Date): Date | null {
  const ref = now ?? new Date();
  if (!Number.isFinite(ref.getTime())) return null;
  const s = expr.trim().toLowerCase();

  // Validate calendar fields before Date can normalize impossible dates.
  const isoMatch = s.match(/^(\d{4}|[+-]\d{6})-(\d{2})-(\d{2})(?:t(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(z|[+-]\d{2}:\d{2})?)?$/);
  if (isoMatch) {
    const [, year, month, day, hour, minute, second, , zone] = isoMatch;
    const calendar = new Date(0);
    calendar.setUTCFullYear(Number(year), Number(month) - 1, Number(day));
    if (calendar.getUTCFullYear() !== Number(year)
      || calendar.getUTCMonth() !== Number(month) - 1
      || calendar.getUTCDate() !== Number(day)
      || Number(hour ?? 0) > 23 || Number(minute ?? 0) > 59
      || Number(second ?? 0) > 59 || year === "-000000") return null;
    const iso = new Date(s.toUpperCase());
    if (!Number.isFinite(iso.getTime())) return null;
    // Local datetimes in a daylight-saving gap must not shift to another clock.
    if (hour !== undefined && zone === undefined
      && (iso.getHours() !== Number(hour) || iso.getMinutes() !== Number(minute))) return null;
    return iso;
  }

  // Relative: "in N unit(s)"
  const relMatch = s.match(
    /^in\s+(\d+(?:\.\d+)?)\s+(minute|min|hour|hr|day|second|sec|week)s?$/,
  );
  if (relMatch) {
    const offset = durationMs(relMatch[1], relMatch[2]);
    if (offset !== null) {
      const target = new Date(ref.getTime() + offset);
      return Number.isFinite(target.getTime()) ? target : null;
    }
  }

  // "tomorrow at HH:MM[am|pm]" or "at HH:MM[am|pm]" or bare "HH:MM[am|pm]"
  const timeMatch = s.match(/^(tomorrow\s+)?(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (timeMatch) {
    const tomorrow = timeMatch[1] !== undefined;
    let hours = Number(timeMatch[2]);
    const minutes = Number(timeMatch[3] ?? 0);
    const ampm = timeMatch[4];
    if (ampm && (hours < 1 || hours > 12)) return null;
    if (ampm === "pm" && hours < 12) hours += 12;
    if (ampm === "am" && hours === 12) hours = 0;
    if (hours > 23 || minutes > 59) return null;

    const target = new Date(ref);
    if (tomorrow) target.setDate(target.getDate() + 1);
    target.setHours(hours, minutes, 0, 0);
    if (!tomorrow && target <= ref) target.setDate(target.getDate() + 1);
    if (!Number.isFinite(target.getTime()) || target.getHours() !== hours
      || target.getMinutes() !== minutes) return null;
    return target;
  }

  return null;
}

/** Parse a repeat expression into interval milliseconds. */
export function parseRepeat(
  expr: string,
): { ms: number; label: string } | null {
  const s = expr.trim().toLowerCase();
  if (s === "daily") return { ms: 24 * 60 * 60 * 1000, label: "daily" };
  if (s === "hourly") return { ms: 60 * 60 * 1000, label: "hourly" };

  const match = s.match(
    /^every\s+(\d+(?:\.\d+)?)\s+(minute|min|hour|hr|day|second|sec|week)s?$/,
  );
  if (match) {
    const ms = durationMs(match[1], match[2]);
    if (ms !== null && isValidRepeatMs(ms)) {
      const n = Number(match[1]);
      return { ms, label: `every ${n} ${match[2]}${n !== 1 ? "s" : ""}` };
    }
  }
  return null;
}

/** Reminders use whole milliseconds within the Date range, at least one second apart. */
export function isValidRepeatMs(ms: number): boolean {
  return Number.isSafeInteger(ms) && ms >= 1000 && ms <= 8_640_000_000_000_000;
}

// Convert decimal units exactly: binary floating-point multiplication can reject
// valid 1.001 seconds or round a sub-millisecond request into a different interval.
function durationMs(amount: string, unit: string): number | null {
  const unitMs = unitToMs(unit);
  if (unitMs === null) return null;
  const [whole, fraction = ""] = amount.split(".");
  const scale = 10n ** BigInt(fraction.length);
  const numerator = BigInt(whole + fraction) * BigInt(unitMs);
  if (numerator % scale !== 0n) return null;
  const ms = numerator / scale;
  return ms <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(ms) : null;
}

function unitToMs(unit: string): number | null {
  switch (unit) {
    case "second": case "sec": return 1000;
    case "minute": case "min": return 60_000;
    case "hour": case "hr": return 3_600_000;
    case "day": return 86_400_000;
    case "week": return 604_800_000;
    default: return null;
  }
}

/** Check if an event payload matches all filter key-value pairs. */
export function matchesFilter(
  payload: Record<string, unknown>,
  filter?: Record<string, string>,
): boolean {
  if (!filter) return true;
  for (const [key, value] of Object.entries(filter)) {
    if (String(payload[key]) !== value) return false;
  }
  return true;
}
