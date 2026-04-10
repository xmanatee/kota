/**
 * Notification gate — holds non-critical channel events during quiet hours and
 * releases them as a single batched digest when the window ends.
 *
 * Implemented by patching bus.emit so the gate applies to all emitters without
 * requiring changes to channel modules (Telegram, Slack, webhook).
 *
 * Gated events (held during quiet hours):
 *   workflow.attention.digest, workflow.budget.exceeded, workflow.budget.warning
 *
 * Critical events (always delivered when allowCritical is true or unset):
 *   workflow.failure.alert, module.crash.alert
 */

import type { EventBus } from "#core/events/event-bus.js";

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
  "workflow.budget.exceeded",
  "workflow.budget.warning",
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

/** Validates a QuietHoursConfig object. Returns an error string or null if valid. */
export function validateQuietHours(q: unknown): string | null {
  if (typeof q !== "object" || q === null || Array.isArray(q)) {
    return "notifications.quietHours must be an object";
  }
  const obj = q as Record<string, unknown>;

  if (typeof obj.start !== "string" || !/^\d{2}:\d{2}$/.test(obj.start)) {
    return 'notifications.quietHours.start must be a string in "HH:MM" format';
  }
  if (typeof obj.end !== "string" || !/^\d{2}:\d{2}$/.test(obj.end)) {
    return 'notifications.quietHours.end must be a string in "HH:MM" format';
  }

  const { h: sh, m: sm } = parseHHMM(obj.start);
  const { h: eh, m: em } = parseHHMM(obj.end);
  if (sh > 23 || sm > 59) return "notifications.quietHours.start has invalid time value";
  if (eh > 23 || em > 59) return "notifications.quietHours.end has invalid time value";

  if (sh * 60 + sm === eh * 60 + em) {
    return "notifications.quietHours.start and end must not be equal";
  }

  if (obj.allowCritical !== undefined && typeof obj.allowCritical !== "boolean") {
    return "notifications.quietHours.allowCritical must be a boolean";
  }

  return null;
}

type HeldEvent = { event: string; payload: Record<string, unknown> };

type EmitFn = (event: string, payload: Record<string, unknown>) => void;

/**
 * NotificationGate holds non-critical bus events during quiet hours and
 * releases them as a single batched digest when the window ends.
 *
 * Patches bus.emit so the gate applies to all emitters without changes to
 * channel modules.
 */
export class NotificationGate {
  private buffer: HeldEvent[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private originalEmit: EmitFn;
  private disposed = false;

  constructor(
    private bus: EventBus,
    private config: QuietHoursConfig,
  ) {
    const original = bus.emit.bind(bus) as EmitFn;
    this.originalEmit = original;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (bus as any).emit = (event: string, payload: Record<string, unknown>) => {
      if (!this.disposed && GATED_EVENTS.has(event) && isWithinQuietHours(this.config)) {
        this.buffer.push({ event, payload });
        this.scheduleRelease();
        return;
      }
      original(event, payload);
    };
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
    this.originalEmit("workflow.attention.digest", { items, text });
  }

  /** Stop the gate and restore the original emit. Buffered events are discarded. */
  dispose(): void {
    this.disposed = true;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this.bus as any).emit = this.originalEmit;
    this.buffer = [];
  }
}
