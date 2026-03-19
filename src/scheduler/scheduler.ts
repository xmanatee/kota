/**
 * Scheduler — manages timed reminders and scheduled tasks.
 *
 * Stores items in ~/.kota/schedules-<hash>.json with the same
 * project-scoping pattern as TaskStore. Supports one-shot reminders
 * and repeating schedules.
 *
 * Pure parsing utilities (parseTime, parseRepeat, etc.) live in
 * schedule-parser.ts for independent testability and reuse.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { EventBus } from "../event-bus.js";
import { tryEmit } from "../event-bus.js";
import {
  formatRelative,
  matchesFilter,
  projectHash,
} from "./schedule-parser.js";

export { parseRepeat, parseTime } from "./schedule-parser.js";

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

type ScheduleFileData = {
  project: string;
  items: ScheduledItem[];
  nextId: number;
};

const MAX_FIRED = 20;

export class Scheduler {
  private items: ScheduledItem[] = [];
  private nextId = 1;
  private filePath: string | null;
  private project: string;
  private loaded = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private busUnsub: (() => void) | null = null;

  constructor(projectDir?: string, storageDir?: string | null) {
    this.project = projectDir || process.cwd();
    if (storageDir === null) {
      this.filePath = null;
      this.loaded = true;
    } else {
      const baseDir = storageDir || join(homedir(), ".kota");
      if (!existsSync(baseDir)) mkdirSync(baseDir, { recursive: true });
      this.filePath = join(baseDir, `schedules-${projectHash(this.project)}.json`);
    }
  }

  private ensureLoaded(): void {
    if (this.loaded) return;
    this.loaded = true;
    if (!this.filePath || !existsSync(this.filePath)) return;
    try {
      const raw = readFileSync(this.filePath, "utf-8");
      const data: ScheduleFileData = JSON.parse(raw);
      if (data.project === this.project) {
        this.items = data.items || [];
        this.nextId = data.nextId || 1;
      }
    } catch {
      this.items = [];
    }
  }

  private persist(): void {
    // Cleanup runs in both memory and persisted modes for consistency
    const fired = this.items.filter((i) => i.status === "fired");
    if (fired.length > MAX_FIRED) {
      const sorted = [...fired].sort((a, b) =>
        (a.firedAt || a.created).localeCompare(b.firedAt || b.created),
      );
      const removeIds = new Set(
        sorted.slice(0, fired.length - MAX_FIRED).map((i) => i.id),
      );
      this.items = this.items.filter((i) => !removeIds.has(i.id));
    }
    this.items = this.items.filter((i) => i.status !== "cancelled");

    if (!this.filePath) return;
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(
      this.filePath,
      JSON.stringify(
        { project: this.project, items: this.items, nextId: this.nextId },
        null,
        2,
      ),
      "utf-8",
    );
  }

  add(
    description: string,
    triggerAt: Date,
    opts?: { repeatMs?: number; repeatLabel?: string },
  ): ScheduledItem {
    this.ensureLoaded();
    const item: ScheduledItem = {
      id: this.nextId++,
      description,
      triggerAt: triggerAt.toISOString(),
      status: "pending",
      created: new Date().toISOString(),
    };
    if (opts?.repeatMs) {
      if (opts.repeatMs < 1000) {
        throw new Error("repeatMs must be at least 1000 (1 second)");
      }
      item.repeatMs = opts.repeatMs;
      item.repeatLabel = opts.repeatLabel;
    }
    this.items.push(item);
    this.persist();
    return item;
  }

  /**
   * Add an event-triggered item. Fires when `eventName` is emitted on the
   * connected EventBus (optionally filtered by payload properties).
   */
  addEventTrigger(
    description: string,
    eventName: string,
    opts?: {
      filter?: Record<string, string>;
      repeat?: boolean;
    },
  ): ScheduledItem {
    this.ensureLoaded();
    if (!eventName) throw new Error("eventName is required");
    const item: ScheduledItem = {
      id: this.nextId++,
      description,
      triggerAt: new Date().toISOString(), // creation time (not used for matching)
      triggerEvent: eventName,
      status: "pending",
      created: new Date().toISOString(),
    };
    if (opts?.filter && Object.keys(opts.filter).length > 0) {
      item.triggerFilter = opts.filter;
    }
    if (opts?.repeat) item.repeat = true;
    this.items.push(item);
    this.persist();
    return item;
  }

  cancel(id: number): boolean {
    this.ensureLoaded();
    const item = this.items.find((i) => i.id === id);
    if (!item || item.status !== "pending") return false;
    item.status = "cancelled";
    this.persist();
    return true;
  }

  getDue(now?: Date): ScheduledItem[] {
    this.ensureLoaded();
    const ref = now || new Date();
    return this.items.filter(
      (i) =>
        i.status === "pending" &&
        !i.triggerEvent && // event-triggered items don't use time-based polling
        new Date(i.triggerAt) <= ref,
    );
  }

  markFired(id: number, now?: Date): ScheduledItem | null {
    this.ensureLoaded();
    const item = this.items.find((i) => i.id === id && i.status === "pending");
    if (!item) return null;
    const ref = now || new Date();

    if (item.triggerEvent && item.repeat) {
      // Event trigger with repeat — re-arm (stay pending for next event)
      item.firedAt = ref.toISOString();
    } else if (item.repeatMs && item.repeatMs >= 1000) {
      const next = new Date(new Date(item.triggerAt).getTime() + item.repeatMs);
      while (next <= ref) next.setTime(next.getTime() + item.repeatMs);
      item.triggerAt = next.toISOString();
      item.firedAt = ref.toISOString();
    } else {
      item.status = "fired";
      item.firedAt = ref.toISOString();
    }
    this.persist();
    tryEmit("schedule.fire", {
      itemId: item.id,
      description: item.description,
    });
    return item;
  }

  list(): ScheduledItem[] {
    this.ensureLoaded();
    return [...this.items];
  }

  pending(): ScheduledItem[] {
    this.ensureLoaded();
    return this.items.filter((i) => i.status === "pending");
  }

  get(id: number): ScheduledItem | undefined {
    this.ensureLoaded();
    return this.items.find((i) => i.id === id);
  }

  getPendingSummary(): string | null {
    this.ensureLoaded();
    const items = this.items.filter((i) => i.status === "pending");
    if (items.length === 0) return null;
    const now = new Date();

    const timeBased = items.filter((i) => !i.triggerEvent);
    const eventBased = items.filter((i) => i.triggerEvent);

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
      const more =
        upcoming.length > 3 ? ` (+${upcoming.length - 3} more)` : "";
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

  startTimer(
    intervalMs: number,
    onDue: (items: ScheduledItem[]) => void,
  ): () => void {
    this.stopTimer();
    this.timer = setInterval(() => {
      const due = this.getDue();
      if (due.length > 0) {
        for (const item of due) this.markFired(item.id);
        onDue(due);
      }
    }, intervalMs);
    this.timer.unref();
    return () => this.stopTimer();
  }

  /**
   * Subscribe to an EventBus so event-triggered items fire automatically.
   * Calls `onFire` with matched items (same shape as `startTimer` callback).
   * Returns an unsubscribe function.
   */
  connectBus(
    bus: EventBus,
    onFire: (items: ScheduledItem[]) => void,
  ): () => void {
    this.disconnectBus();
    this.busUnsub = bus.on("*", (envelope) => {
      // Skip schedule.fire to prevent self-triggering loops
      if (envelope.type === "schedule.fire") return;

      this.ensureLoaded();
      const matches = this.items.filter(
        (i) =>
          i.status === "pending" &&
          i.triggerEvent === envelope.type &&
          matchesFilter(
            envelope.payload as Record<string, unknown>,
            i.triggerFilter,
          ),
      );
      if (matches.length === 0) return;

      for (const item of matches) this.markFired(item.id);
      onFire(matches);
    });
    return () => this.disconnectBus();
  }

  /** Disconnect from the EventBus. */
  disconnectBus(): void {
    if (this.busUnsub) {
      this.busUnsub();
      this.busUnsub = null;
    }
  }

  stopTimer(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  count(): number {
    this.ensureLoaded();
    return this.items.filter((i) => i.status === "pending").length;
  }
}

// --- Singleton ---

let instance: Scheduler | undefined;

/**
 * Initialize the scheduler singleton. Idempotent — if an instance already
 * exists for the same project directory, it is reused rather than replaced.
 * This prevents multi-session contexts (HTTP server, Telegram bot) from
 * stomping on each other's scheduler instances.
 */
export function initScheduler(
  projectDir?: string,
  storageDir?: string | null,
): void {
  if (instance) return;
  instance = new Scheduler(projectDir, storageDir);
}

export function getScheduler(): Scheduler {
  if (!instance) instance = new Scheduler(undefined, null);
  return instance;
}

export function resetScheduler(): void {
  if (instance) {
    instance.disconnectBus();
    instance.stopTimer();
  }
  instance = undefined;
}
