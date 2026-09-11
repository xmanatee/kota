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
  const ref = now || new Date();
  const s = expr.trim().toLowerCase();

  // ISO datetime
  const iso = new Date(expr.trim());
  if (!Number.isNaN(iso.getTime()) && /\d{4}-\d{2}/.test(expr)) return iso;

  // Relative: "in N unit(s)"
  const relMatch = s.match(
    /^in\s+(\d+(?:\.\d+)?)\s+(minute|min|hour|hr|day|second|sec|week)s?$/,
  );
  if (relMatch) {
    const n = parseFloat(relMatch[1]);
    const ms = unitToMs(relMatch[2]);
    if (ms) return new Date(ref.getTime() + n * ms);
  }

  // "tomorrow at HH:MM[am|pm]" or "at HH:MM[am|pm]" or bare "HH:MM[am|pm]"
  const tomorrow = s.startsWith("tomorrow");
  const timeMatch = s.match(/(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (timeMatch) {
    let hours = parseInt(timeMatch[1], 10);
    const minutes = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
    const ampm = timeMatch[3];
    if (ampm === "pm" && hours < 12) hours += 12;
    if (ampm === "am" && hours === 12) hours = 0;
    if (hours > 23 || minutes > 59) return null;

    const target = new Date(ref);
    target.setHours(hours, minutes, 0, 0);
    if (tomorrow) target.setDate(target.getDate() + 1);
    else if (target <= ref) target.setDate(target.getDate() + 1);
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
    const n = parseFloat(match[1]);
    const ms = unitToMs(match[2]);
    if (ms) {
      return { ms: n * ms, label: `every ${n} ${match[2]}${n !== 1 ? "s" : ""}` };
    }
  }
  return null;
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
