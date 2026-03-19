/**
 * File I/O helpers for the Scheduler.
 *
 * Extracted from scheduler.ts to keep storage concerns separate from
 * scheduling logic. Reads/writes schedule JSON files; handles cleanup
 * of excess fired items and cancelled items on every save.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ScheduledItem } from "./schedule-parser.js";

type ScheduleFileData = {
  project: string;
  items: ScheduledItem[];
  nextId: number;
};

const MAX_FIRED = 20;

export function loadFromFile(
  filePath: string,
  project: string,
): { items: ScheduledItem[]; nextId: number } {
  if (!existsSync(filePath)) return { items: [], nextId: 1 };
  try {
    const raw = readFileSync(filePath, "utf-8");
    const data: ScheduleFileData = JSON.parse(raw);
    if (data.project === project) {
      return { items: data.items || [], nextId: data.nextId || 1 };
    }
    return { items: [], nextId: 1 };
  } catch {
    return { items: [], nextId: 1 };
  }
}

export function persistToFile(
  filePath: string | null,
  project: string,
  items: ScheduledItem[],
  nextId: number,
): ScheduledItem[] {
  const fired = items.filter((i) => i.status === "fired");
  let clean = items;
  if (fired.length > MAX_FIRED) {
    const sorted = [...fired].sort((a, b) =>
      (a.firedAt || a.created).localeCompare(b.firedAt || b.created),
    );
    const removeIds = new Set(
      sorted.slice(0, fired.length - MAX_FIRED).map((i) => i.id),
    );
    clean = items.filter((i) => !removeIds.has(i.id));
  }
  clean = clean.filter((i) => i.status !== "cancelled");
  if (filePath) {
    const dir = dirname(filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(
      filePath,
      JSON.stringify({ project, items: clean, nextId }, null, 2),
      "utf-8",
    );
  }
  return clean;
}
