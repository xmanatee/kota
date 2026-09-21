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
 *   N/S      exact N (step on a singleton range)
 *
 * DOM/DOW interaction: AND semantics — both must match when neither is *.
 * 0 and 7 are both treated as Sunday in the DOW field.
 */

type DecodedCron = {
  minutes: ReadonlySet<number>;
  hours: ReadonlySet<number>;
  doms: ReadonlySet<number>;
  months: ReadonlySet<number>;
  dows: ReadonlySet<number>;
};

type CronDecodeResult = { ok: true; cron: DecodedCron } | { ok: false; error: string };

function decodeCronField(field: string, min: number, max: number): Set<number> | string {
  const ranges: { lo: number; hi: number; step: number }[] = [];
  for (const part of field.split(",")) {
    const match = /^(\*|[0-9]+(?:-[0-9]+)?)(?:\/([0-9]+))?$/.exec(part);
    if (!match) return `invalid syntax in part "${part}"; expected *, N, N-M, or a positive /step`;
    const step = match[2] === undefined ? 1 : Number(match[2]);
    if (!Number.isSafeInteger(step) || step < 1) return "step must be a positive safe integer";
    const [start, end = start] = match[1].split("-");
    const lo = start === "*" ? min : Number(start);
    const hi = start === "*" ? max : Number(end);
    if (!Number.isSafeInteger(lo) || !Number.isSafeInteger(hi) || lo < min || hi > max) {
      return `endpoints must be safe integers in ${min}-${max}`;
    }
    if (lo > hi) return "range start must not exceed range end";
    ranges.push({ lo, hi, step });
  }

  // Enumerate only the field's finite domain after every part is validated.
  // Work never scales with an untrusted endpoint or step magnitude.
  const values = new Set<number>();
  for (let value = min; value <= max; value++) {
    if (ranges.some(({ lo, hi, step }) => value >= lo && value <= hi && (value - lo) % step === 0)) {
      values.add(value);
    }
  }
  return values;
}

function decodeCronExpr(expr: string): CronDecodeResult {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) {
    return { ok: false, error: `cron expression must have 5 fields, got ${parts.length}: "${expr}"` };
  }
  const fields = [
    ["minute", 0, 59],
    ["hour", 0, 23],
    ["day-of-month", 1, 31],
    ["month", 1, 12],
    ["day-of-week", 0, 7],
  ] as const;
  const values: Set<number>[] = [];
  for (const [index, [name, min, max]] of fields.entries()) {
    const decoded = decodeCronField(parts[index], min, max);
    if (typeof decoded === "string") {
      return { ok: false, error: `${name} field "${parts[index]}": ${decoded}` };
    }
    values.push(decoded);
  }
  const [minutes, hours, doms, months, dows] = values;
  // Normalize the Sunday alias once for every consumer.
  if (dows.delete(7)) dows.add(0);
  return { ok: true, cron: { minutes, hours, doms, months, dows } };
}

/** Validate a cron expression. Returns null if valid, error message if not. */
export function validateCronExpr(expr: string): string | null {
  const decoded = decodeCronExpr(expr);
  return decoded.ok ? null : decoded.error;
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
function getLocalParts(date: Date, fmt: Intl.DateTimeFormat): LocalParts {
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

/** Extract wall-clock date/time components in UTC. */
function getUtcParts(date: Date): LocalParts {
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    dom: date.getUTCDate(),
    dow: date.getUTCDay(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
  };
}

function localTimestamp(parts: LocalParts): number {
  return Date.UTC(parts.year, parts.month - 1, parts.dom, parts.hour, parts.minute);
}

/**
 * Compute the next fire time for a cron expression strictly after `from`.
 * When `timezone` is provided (IANA name), the expression is evaluated in that
 * timezone's wall-clock time. When omitted, UTC wall-clock time is used.
 * Nonexistent local minutes are skipped; repeated minutes match on both passes.
 * Returns null if no match is found within 4 years.
 */
export function getNextCronTime(expr: string, from: Date, timezone?: string): Date | null {
  const decoded = decodeCronExpr(expr);
  if (!decoded.ok) return null;
  const { minutes, hours, doms, months, dows } = decoded.cron;

  // Start one minute after `from`, zero out sub-minute precision
  const start = new Date(from.getTime() + 60_000);
  start.setUTCSeconds(0, 0);

  const maxMs = from.getTime() + 4 * 365 * 24 * 60 * 60 * 1000;
  let cur = start;

  // Reuse one formatter for the entire bounded search.
  const formatter = timezone && timezone !== "UTC"
    ? new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
    : undefined;

  while (cur.getTime() <= maxMs) {
    const local = formatter ? getLocalParts(cur, formatter) : getUtcParts(cur);
    const { year, month, dom, dow, hour, minute } = local;

    const advanceTowardLocalTime = (y: number, mo: number, d: number, h: number, mi: number): Date => {
      const target = Date.UTC(y, mo - 1, d, h, mi);
      if (!formatter) return new Date(target);

      // Field skips are safe only inside a constant-offset interval. IANA zone
      // transitions are separated by more than an hour, so compare offsets at
      // most an hour apart. Across a change, walk absolute minutes instead:
      // never invert an ambiguous/missing wall time or skip the repeated hour.
      const currentMs = cur.getTime();
      const localMs = localTimestamp(local);
      const delta = Math.min(target - localMs, 60 * 60_000);
      const candidate = new Date(currentMs + delta);
      const candidateLocalMs = localTimestamp(getLocalParts(candidate, formatter));
      return candidateLocalMs - localMs === delta
        ? candidate
        : new Date(currentMs + 60_000);
    };

    if (!months.has(month)) {
      const nextMonth = month === 12 ? 1 : month + 1;
      const nextYear = month === 12 ? year + 1 : year;
      cur = advanceTowardLocalTime(nextYear, nextMonth, 1, 0, 0);
      continue;
    }
    if (!doms.has(dom) || !dows.has(dow)) {
      cur = advanceTowardLocalTime(year, month, dom + 1, 0, 0);
      continue;
    }
    if (!hours.has(hour)) {
      const nextHour = [...hours]
        .filter((h) => h > hour)
        .sort((a, b) => a - b)[0];
      if (nextHour !== undefined) {
        cur = advanceTowardLocalTime(year, month, dom, nextHour, 0);
      } else {
        cur = advanceTowardLocalTime(year, month, dom + 1, 0, 0);
      }
      continue;
    }
    if (!minutes.has(minute)) {
      const nextMin = [...minutes]
        .filter((m) => m > minute)
        .sort((a, b) => a - b)[0];
      if (nextMin !== undefined) {
        cur = advanceTowardLocalTime(year, month, dom, hour, nextMin);
      } else {
        cur = advanceTowardLocalTime(year, month, dom, hour + 1, 0);
      }
      continue;
    }
    return cur;
  }
  return null;
}
