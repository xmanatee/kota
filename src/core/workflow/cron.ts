/**
 * Minimal 5-field cron expression parser.
 *
 * Field order: MIN HOUR DOM MONTH DOW
 * Field syntax per part (comma-separated):
 *   *        any value
 *   N        exact value
 *   N-M      range
 *   *\/N     every N starting from field min
 *   N-M/N    every N within range
 *
 * DOM/DOW interaction: AND semantics — both must match when neither is *.
 * 0 and 7 are both treated as Sunday in the DOW field.
 */

function parseCronField(field: string, min: number, max: number): Set<number> {
  const result = new Set<number>();
  for (const part of field.split(",")) {
    if (part === "*") {
      for (let i = min; i <= max; i++) result.add(i);
      continue;
    }
    let rangeStr = part;
    let step = 1;
    const slashIdx = part.indexOf("/");
    if (slashIdx >= 0) {
      step = Number.parseInt(part.slice(slashIdx + 1), 10);
      rangeStr = part.slice(0, slashIdx);
    }
    let lo = min;
    let hi = max;
    if (rangeStr !== "*") {
      const dashIdx = rangeStr.indexOf("-");
      if (dashIdx >= 0) {
        lo = Number.parseInt(rangeStr.slice(0, dashIdx), 10);
        hi = Number.parseInt(rangeStr.slice(dashIdx + 1), 10);
      } else {
        lo = hi = Number.parseInt(rangeStr, 10);
      }
    }
    for (let i = lo; i <= hi; i += step) result.add(i);
  }
  return result;
}

/** Validate a cron expression. Returns null if valid, error message if not. */
export function validateCronExpr(expr: string): string | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) {
    return `cron expression must have 5 fields, got ${parts.length}: "${expr}"`;
  }
  const ranges: [number, number][] = [
    [0, 59],
    [0, 23],
    [1, 31],
    [1, 12],
    [0, 7],
  ];
  const names = [
    "minute",
    "hour",
    "day-of-month",
    "month",
    "day-of-week",
  ];
  for (let i = 0; i < 5; i++) {
    const field = parts[i];
    if (!/^[\d*,\-/]+$/.test(field)) {
      return `invalid characters in ${names[i]} field: "${field}"`;
    }
    try {
      const values = parseCronField(field, ranges[i][0], ranges[i][1]);
      if (values.size === 0) {
        return `${names[i]} field "${field}" produces no valid values`;
      }
    } catch {
      return `failed to parse ${names[i]} field: "${field}"`;
    }
  }
  return null;
}

/** Validate an IANA timezone name. Returns null if valid, error message if not. */
export function validateTimezone(tz: string): string | null {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return null;
  } catch {
    return `invalid timezone: "${tz}"`;
  }
}

type LocalParts = {
  year: number;
  month: number; // 1-12
  dom: number; // 1-31
  dow: number; // 0=Sun, 1=Mon, ..., 6=Sat
  hour: number; // 0-23
  minute: number; // 0-59
};

/** Extract wall-clock date/time components in the given IANA timezone. */
function getLocalParts(date: Date, tz: string): LocalParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(date)
      .filter((p) => p.type !== "literal")
      .map((p) => [p.type, p.value]),
  );
  const year = parseInt(parts.year, 10);
  const month = parseInt(parts.month, 10);
  const dom = parseInt(parts.day, 10);
  // hour12: false can return "24" for midnight in some environments
  const hour = parseInt(parts.hour, 10) % 24;
  const minute = parseInt(parts.minute, 10);
  // Compute DOW from the local date components (avoids local TZ of the process)
  const dow = new Date(Date.UTC(year, month - 1, dom)).getUTCDay();
  return { year, month, dom, dow, hour, minute };
}

/** Extract wall-clock date/time components in the process local timezone. */
function getLocalPartsLocal(date: Date): LocalParts {
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    dom: date.getDate(),
    dow: date.getDay(),
    hour: date.getHours(),
    minute: date.getMinutes(),
  };
}

/**
 * Convert a wall-clock date/time in the given IANA timezone to a UTC Date.
 * Uses a single-pass offset approximation — correct except in rare edge cases
 * exactly at DST transitions (off by at most one hour, self-corrected by the
 * iteration in getNextCronTime).
 */
function localTimeToUTC(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  tz: string,
): Date {
  // Treat the local components as UTC to get an approximate timestamp
  const approxMs = Date.UTC(year, month - 1, day, hour, minute, 0);
  const approxDate = new Date(approxMs);
  // Get actual local components of that approximate UTC time in the target TZ
  const lp = getLocalParts(approxDate, tz);
  const lpMs = Date.UTC(lp.year, lp.month - 1, lp.dom, lp.hour, lp.minute, 0);
  // Offset = UTC - local; corrected UTC = target local ms + offset
  const offsetMs = approxMs - lpMs;
  return new Date(approxMs + offsetMs);
}

/**
 * Compute the next fire time for a cron expression strictly after `from`.
 * When `timezone` is provided (IANA name), the expression is evaluated in that
 * timezone's wall-clock time. When omitted, the process local timezone is used.
 * Returns null if no match is found within 4 years.
 */
export function getNextCronTime(expr: string, from: Date, timezone?: string): Date | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;

  const [minuteField, hourField, domField, monthField, dowField] = parts;
  const minutes = parseCronField(minuteField, 0, 59);
  const hours = parseCronField(hourField, 0, 23);
  const doms = parseCronField(domField, 1, 31);
  const months = parseCronField(monthField, 1, 12);
  const dows = parseCronField(dowField, 0, 7);
  // Normalize: 7 → 0 (both mean Sunday)
  if (dows.has(7)) {
    dows.add(0);
    dows.delete(7);
  }

  // Start one minute after `from`, zero out sub-minute precision
  const start = new Date(from.getTime() + 60_000);
  start.setSeconds(0, 0);

  const maxMs = from.getTime() + 4 * 365 * 24 * 60 * 60 * 1000;
  let cur = start;

  const lp = (d: Date): LocalParts =>
    timezone ? getLocalParts(d, timezone) : getLocalPartsLocal(d);

  const mkDate = (y: number, mo: number, d: number, h: number, mi: number): Date =>
    timezone
      ? localTimeToUTC(y, mo, d, h, mi, timezone)
      : new Date(y, mo - 1, d, h, mi, 0, 0);

  while (cur.getTime() <= maxMs) {
    const { year, month, dom, dow, hour, minute } = lp(cur);

    if (!months.has(month)) {
      const nextMonth = month === 12 ? 1 : month + 1;
      const nextYear = month === 12 ? year + 1 : year;
      cur = mkDate(nextYear, nextMonth, 1, 0, 0);
      continue;
    }
    if (!doms.has(dom) || !dows.has(dow)) {
      cur = mkDate(year, month, dom + 1, 0, 0);
      continue;
    }
    if (!hours.has(hour)) {
      const nextHour = [...hours]
        .filter((h) => h > hour)
        .sort((a, b) => a - b)[0];
      if (nextHour !== undefined) {
        cur = mkDate(year, month, dom, nextHour, 0);
      } else {
        cur = mkDate(year, month, dom + 1, 0, 0);
      }
      continue;
    }
    if (!minutes.has(minute)) {
      const nextMin = [...minutes]
        .filter((m) => m > minute)
        .sort((a, b) => a - b)[0];
      if (nextMin !== undefined) {
        cur = mkDate(year, month, dom, hour, nextMin);
      } else {
        cur = mkDate(year, month, dom, hour + 1, 0);
      }
      continue;
    }
    return cur;
  }
  return null;
}
