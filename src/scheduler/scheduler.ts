/**
 * Scheduler — manages timed reminders and scheduled tasks.
 *
 * Stores items in ~/.kota/schedules-<hash>.json with the same
 * project-scoping pattern as TaskStore. Supports one-shot reminders
 * and repeating schedules.
 *
 * Pure parsing utilities (parseTime, parseRepeat, etc.) live in
 * schedule-parser.ts. File I/O helpers live in scheduler-store.ts.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import type { EventBus } from "../event-bus.js";
import { tryEmit } from "../event-bus.js";
import {
  getPendingSummary,
  matchesFilter,
  projectHash,
} from "./schedule-parser.js";
import { loadFromFile, persistToFile } from "./scheduler-store.js";

export type { ScheduledItem } from "./schedule-parser.js";
export { parseRepeat, parseTime } from "./schedule-parser.js";

export class Scheduler {
  private items: import("./schedule-parser.js").ScheduledItem[] = [];
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
      this.filePath = join(baseDir, `schedules-${projectHash(this.project)}.json`);
    }
  }

  private ensureLoaded(): void {
    if (this.loaded) return;
    this.loaded = true;
    if (!this.filePath) return;
    const data = loadFromFile(this.filePath, this.project);
    this.items = data.items;
    this.nextId = data.nextId;
  }

  private persist(): void {
    this.items = persistToFile(this.filePath, this.project, this.items, this.nextId);
  }

  add(
    description: string,
    triggerAt: Date,
    opts?: { repeatMs?: number; repeatLabel?: string },
  ): import("./schedule-parser.js").ScheduledItem {
    this.ensureLoaded();
    const item: import("./schedule-parser.js").ScheduledItem = {
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
  ): import("./schedule-parser.js").ScheduledItem {
    this.ensureLoaded();
    if (!eventName) throw new Error("eventName is required");
    const item: import("./schedule-parser.js").ScheduledItem = {
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

  getDue(now?: Date): import("./schedule-parser.js").ScheduledItem[] {
    this.ensureLoaded();
    const ref = now || new Date();
    return this.items.filter(
      (i) =>
        i.status === "pending" &&
        !i.triggerEvent &&
        new Date(i.triggerAt) <= ref,
    );
  }

  markFired(id: number, now?: Date): import("./schedule-parser.js").ScheduledItem | null {
    this.ensureLoaded();
    const item = this.items.find((i) => i.id === id && i.status === "pending");
    if (!item) return null;
    const ref = now || new Date();

    if (item.triggerEvent && item.repeat) {
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

  list(): import("./schedule-parser.js").ScheduledItem[] {
    this.ensureLoaded();
    return [...this.items];
  }

  pending(): import("./schedule-parser.js").ScheduledItem[] {
    this.ensureLoaded();
    return this.items.filter((i) => i.status === "pending");
  }

  get(id: number): import("./schedule-parser.js").ScheduledItem | undefined {
    this.ensureLoaded();
    return this.items.find((i) => i.id === id);
  }

  getPendingSummary(): string | null {
    this.ensureLoaded();
    return getPendingSummary(this.items);
  }

  startTimer(
    intervalMs: number,
    onDue: (items: import("./schedule-parser.js").ScheduledItem[]) => void,
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
    onFire: (items: import("./schedule-parser.js").ScheduledItem[]) => void,
  ): () => void {
    this.disconnectBus();
    this.busUnsub = bus.on("*", (envelope) => {
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
