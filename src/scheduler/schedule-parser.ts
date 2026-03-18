/**
 * Pure parsing and utility functions for the scheduler.
 *
 * Extracted from scheduler.ts so parsing logic is independently
 * testable and reusable without importing the Scheduler class.
 */

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
