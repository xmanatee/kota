/**
 * Pure parsing, formatting, and type definitions for the scheduler.
 *
 * Extracted from scheduler.ts so parsing logic is independently
 * testable and reusable without importing the Scheduler class.
 */

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

/** Build a human-readable summary of pending scheduled items. */
export function getPendingSummary(items: ScheduledItem[]): string | null {
  const pending = items.filter((i) => i.status === "pending");
  if (pending.length === 0) return null;
  const now = new Date();

  const timeBased = pending.filter((i) => !i.triggerEvent);
  const eventBased = pending.filter((i) => i.triggerEvent);

  const overdue = timeBased.filter((i) => new Date(i.triggerAt) <= now);
  const upcoming = timeBased.filter((i) => new Date(i.triggerAt) > now);

  const parts: string[] = [];
  if (overdue.length > 0) {
    parts.push(
      `${overdue.length} OVERDUE: ${overdue.map((i) => `"${i.description}"`).join(", ")}`,
    );
  }
  if (upcoming.length > 0) {
    const preview = upcoming.slice(0, 3).map((i) => {
      const label = formatRelative(new Date(i.triggerAt), now);
      return `"${i.description}" (${label})`;
    });
    const more = upcoming.length > 3 ? ` (+${upcoming.length - 3} more)` : "";
    parts.push(`${upcoming.length} upcoming: ${preview.join(", ")}${more}`);
  }
  if (eventBased.length > 0) {
    const preview = eventBased.slice(0, 3).map((i) => {
      const repeatTag = i.repeat ? ", repeat" : "";
      return `"${i.description}" (on ${i.triggerEvent}${repeatTag})`;
    });
    const more =
      eventBased.length > 3 ? ` (+${eventBased.length - 3} more)` : "";
    parts.push(
      `${eventBased.length} event-triggered: ${preview.join(", ")}${more}`,
    );
  }
  return parts.join("; ");
}

/**
 * Deterministic hash for project-scoping storage files.
 * Used by both Scheduler and TaskStore to derive per-project filenames.
 */
export function projectHash(path: string): string {
  let h = 5381;
  for (let i = 0; i < path.length; i++) {
    h = ((h << 5) + h + path.charCodeAt(i)) >>> 0;
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

/** Format a Date as a human-readable relative time string. */
export function formatRelative(target: Date, now: Date): string {
  const diffMs = target.getTime() - now.getTime();
  if (diffMs <= 0) return "overdue";
  const mins = Math.round(diffMs / 60_000);
  if (mins < 60) return `in ${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `in ${hours}h`;
  const days = Math.round(hours / 24);
  return `in ${days}d`;
}
