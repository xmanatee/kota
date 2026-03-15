/**
 * Scheduler — manages timed reminders and scheduled tasks.
 *
 * Stores items in ~/.kota/schedules-<hash>.json with the same
 * project-scoping pattern as TaskStore. Supports one-shot reminders
 * and repeating schedules.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export type ScheduledItem = {
  id: number;
  description: string;
  triggerAt: string; // ISO datetime
  repeatMs?: number;
  repeatLabel?: string;
  action?: string; // Agent prompt to execute when triggered
  status: "pending" | "fired" | "cancelled";
  created: string;
  firedAt?: string;
};

type ScheduleFileData = {
  project: string;
  items: ScheduledItem[];
  nextId: number;
};

const MAX_FIRED = 20;

function projectHash(path: string): string {
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
  if (!isNaN(iso.getTime()) && /\d{4}-\d{2}/.test(expr)) return iso;

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

export class Scheduler {
  private items: ScheduledItem[] = [];
  private nextId = 1;
  private filePath: string | null;
  private project: string;
  private loaded = false;
  private timer: ReturnType<typeof setInterval> | null = null;

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
    if (!this.filePath) return;
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
    const dir = this.filePath.replace(/\/[^/]+$/, "");
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
    opts?: { repeatMs?: number; repeatLabel?: string; action?: string },
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
      item.repeatMs = opts.repeatMs;
      item.repeatLabel = opts.repeatLabel;
    }
    if (opts?.action) {
      item.action = opts.action;
    }
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
      (i) => i.status === "pending" && new Date(i.triggerAt) <= ref,
    );
  }

  markFired(id: number, now?: Date): ScheduledItem | null {
    this.ensureLoaded();
    const item = this.items.find((i) => i.id === id);
    if (!item) return null;
    const ref = now || new Date();

    if (item.repeatMs) {
      const next = new Date(new Date(item.triggerAt).getTime() + item.repeatMs);
      while (next <= ref) next.setTime(next.getTime() + item.repeatMs);
      item.triggerAt = next.toISOString();
      item.firedAt = ref.toISOString();
    } else {
      item.status = "fired";
      item.firedAt = ref.toISOString();
    }
    this.persist();
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
    const overdue = items.filter((i) => new Date(i.triggerAt) <= now);
    const upcoming = items.filter((i) => new Date(i.triggerAt) > now);

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

function formatRelative(target: Date, now: Date): string {
  const diffMs = target.getTime() - now.getTime();
  if (diffMs <= 0) return "overdue";
  const mins = Math.round(diffMs / 60_000);
  if (mins < 60) return `in ${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `in ${hours}h`;
  const days = Math.round(hours / 24);
  return `in ${days}d`;
}

// --- Singleton ---

let instance: Scheduler | undefined;

export function initScheduler(
  projectDir?: string,
  storageDir?: string | null,
): void {
  instance = new Scheduler(projectDir, storageDir);
}

export function getScheduler(): Scheduler {
  if (!instance) instance = new Scheduler(undefined, null);
  return instance;
}

export function resetScheduler(): void {
  if (instance) instance.stopTimer();
  instance = undefined;
}
