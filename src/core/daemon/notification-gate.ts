/**
 * Notification gate — holds non-critical channel events during quiet hours and
 * releases them as a single batched digest when the window ends.
 *
 * Implemented as an `EventBus.addEmitMiddleware` consumer so the gate applies
 * to every emitter without requiring channel modules (Telegram, Slack, webhook)
 * to opt in.
 *
 * Gated events (held during quiet hours):
 *   workflow.attention.digest
 *
 * Critical events (always delivered when allowCritical is true or unset):
 *   workflow.failure.alert, module.crash.alert
 */

import type { EmitMiddleware, EventBus } from "#core/events/event-bus.js";

export type QuietHoursConfig = {
  /** Quiet period start in local time, "HH:MM" (24-hour). */
  start: string;
  /** Quiet period end in local time, "HH:MM" (24-hour). Spans crossing midnight are supported. */
  end: string;
  /**
   * When true (default), critical events bypass quiet hours.
   * Critical: workflow.failure.alert, module.crash.alert.
   */
  allowCritical?: boolean;
};

/** Events held during quiet hours. */
const GATED_EVENTS: ReadonlySet<string> = new Set([
  "workflow.attention.digest",
  "workflow.daily.digest",
]);

function parseHHMM(s: string): { h: number; m: number } {
  const parts = s.split(":");
  return { h: parseInt(parts[0] ?? "0", 10), m: parseInt(parts[1] ?? "0", 10) };
}

/** Returns true if the given time falls within quiet hours. Handles midnight-spanning windows. */
export function isWithinQuietHours(config: QuietHoursConfig, now = new Date()): boolean {
  const { h: sh, m: sm } = parseHHMM(config.start);
  const { h: eh, m: em } = parseHHMM(config.end);
  const startMins = sh * 60 + sm;
  const endMins = eh * 60 + em;
  const nowMins = now.getHours() * 60 + now.getMinutes();

  if (startMins < endMins) {
    // Same-day window (e.g. 01:00–06:00)
    return nowMins >= startMins && nowMins < endMins;
  }
  // Midnight-spanning window (e.g. 22:00–08:00)
  return nowMins >= startMins || nowMins < endMins;
}

/** Returns ms until quiet hours end (when buffered events will be released). */
export function msUntilQuietHoursEnd(config: QuietHoursConfig, now = new Date()): number {
  const { h: eh, m: em } = parseHHMM(config.end);
  const endMins = eh * 60 + em;
  const nowMins = now.getHours() * 60 + now.getMinutes();

  const minsUntilEnd = nowMins < endMins ? endMins - nowMins : 24 * 60 - nowMins + endMins;

  const msElapsedInMinute = now.getSeconds() * 1000 + now.getMilliseconds();
  return minsUntilEnd * 60 * 1000 - msElapsedInMinute;
}

/**
 * Discriminated parse result for the notifications.quietHours config slice.
 *
 * The config sanitizer parses raw user JSON; the daemon constructor consumes
 * an already-validated `QuietHoursConfig`. Splitting parse from consumption
 * means the only `unknown → typed` narrowing happens here, and downstream
 * code can rely on the type without reaching back into the raw record.
 */
export type ParsedQuietHours =
  | { ok: true; config: QuietHoursConfig }
  | { ok: false; error: string };

/** Parse and validate a raw quiet-hours config slice. */
export function parseQuietHours(q: unknown): ParsedQuietHours {
  if (typeof q !== "object" || q === null || Array.isArray(q)) {
    return { ok: false, error: "notifications.quietHours must be an object" };
  }
  const obj = q as Record<string, unknown>;

  if (typeof obj.start !== "string" || !/^\d{2}:\d{2}$/.test(obj.start)) {
    return {
      ok: false,
      error: 'notifications.quietHours.start must be a string in "HH:MM" format',
    };
  }
  if (typeof obj.end !== "string" || !/^\d{2}:\d{2}$/.test(obj.end)) {
    return {
      ok: false,
      error: 'notifications.quietHours.end must be a string in "HH:MM" format',
    };
  }

  const { h: sh, m: sm } = parseHHMM(obj.start);
  const { h: eh, m: em } = parseHHMM(obj.end);
  if (sh > 23 || sm > 59) {
    return { ok: false, error: "notifications.quietHours.start has invalid time value" };
  }
  if (eh > 23 || em > 59) {
    return { ok: false, error: "notifications.quietHours.end has invalid time value" };
  }

  if (sh * 60 + sm === eh * 60 + em) {
    return { ok: false, error: "notifications.quietHours.start and end must not be equal" };
  }

  if (obj.allowCritical !== undefined && typeof obj.allowCritical !== "boolean") {
    return { ok: false, error: "notifications.quietHours.allowCritical must be a boolean" };
  }

  const config: QuietHoursConfig = { start: obj.start, end: obj.end };
  if (typeof obj.allowCritical === "boolean") config.allowCritical = obj.allowCritical;
  return { ok: true, config };
}

type HeldEvent = { event: string; payload: Record<string, unknown> };

/**
 * NotificationGate holds non-critical bus events during quiet hours and
 * releases them as a single batched digest when the window ends.
 *
 * Registers an `EmitMiddleware` on the bus so the gate applies to every
 * emitter without changes to channel modules. The release path re-emits the
 * batched digest through the same `bus.emit` and uses a local `releasing`
 * flag to bypass its own gate, so no monkey-patch or "direct dispatch" hatch
 * is needed.
 */
export class NotificationGate {
  private buffer: HeldEvent[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private unsubscribeMiddleware: () => void;
  private disposed = false;
  private releasing = false;

  constructor(
    private bus: EventBus,
    private config: QuietHoursConfig,
  ) {
    const middleware: EmitMiddleware = (envelope, next) => {
      if (
        this.disposed ||
        this.releasing ||
        !GATED_EVENTS.has(envelope.type) ||
        !isWithinQuietHours(this.config)
      ) {
        next();
        return;
      }
      this.buffer.push({ event: envelope.type, payload: envelope.payload });
      this.scheduleRelease();
    };
    this.unsubscribeMiddleware = bus.addEmitMiddleware(middleware);
  }

  private scheduleRelease(): void {
    if (this.timer !== null) return;
    const ms = msUntilQuietHoursEnd(this.config);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.releaseBuffer();
    }, ms);
  }

  private releaseBuffer(): void {
    if (this.buffer.length === 0) return;
    const items = this.buffer.map(({ event, payload }) => {
      const label = event.replace(/^workflow\./, "").replace(/\./g, " ");
      const detail = typeof payload.text === "string" ? payload.text : event;
      return { label, detail };
    });
    const text = `Quiet hours ended — ${items.length} held notification(s):\n${items.map((i) => `• ${i.detail}`).join("\n")}`;
    this.buffer = [];
    this.releasing = true;
    try {
      this.bus.emit("workflow.attention.digest", { items, text });
    } finally {
      this.releasing = false;
    }
  }

  /** Stop the gate and remove its middleware. Buffered events are discarded. */
  dispose(): void {
    this.disposed = true;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.unsubscribeMiddleware();
    this.buffer = [];
  }
}
