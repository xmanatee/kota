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

/**
 * Compute the next fire time for a cron expression strictly after `from`.
 * Returns null if no match is found within 4 years.
 */
export function getNextCronTime(expr: string, from: Date): Date | null {
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

  while (cur.getTime() <= maxMs) {
    const month = cur.getMonth() + 1; // 1-12
    const dom = cur.getDate(); // 1-31
    const dow = cur.getDay(); // 0-6
    const hour = cur.getHours();
    const minute = cur.getMinutes();

    if (!months.has(month)) {
      cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1, 0, 0, 0, 0);
      continue;
    }
    if (!doms.has(dom) || !dows.has(dow)) {
      cur = new Date(
        cur.getFullYear(),
        cur.getMonth(),
        cur.getDate() + 1,
        0,
        0,
        0,
        0,
      );
      continue;
    }
    if (!hours.has(hour)) {
      const nextHour = [...hours]
        .filter((h) => h > hour)
        .sort((a, b) => a - b)[0];
      if (nextHour !== undefined) {
        cur = new Date(
          cur.getFullYear(),
          cur.getMonth(),
          cur.getDate(),
          nextHour,
          0,
          0,
          0,
        );
      } else {
        cur = new Date(
          cur.getFullYear(),
          cur.getMonth(),
          cur.getDate() + 1,
          0,
          0,
          0,
          0,
        );
      }
      continue;
    }
    if (!minutes.has(minute)) {
      const nextMin = [...minutes]
        .filter((m) => m > minute)
        .sort((a, b) => a - b)[0];
      if (nextMin !== undefined) {
        cur = new Date(
          cur.getFullYear(),
          cur.getMonth(),
          cur.getDate(),
          cur.getHours(),
          nextMin,
          0,
          0,
        );
      } else {
        cur = new Date(
          cur.getFullYear(),
          cur.getMonth(),
          cur.getDate(),
          cur.getHours() + 1,
          0,
          0,
          0,
        );
      }
      continue;
    }
    return cur;
  }
  return null;
}
