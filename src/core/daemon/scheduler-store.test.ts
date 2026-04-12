import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ScheduledItem } from "./schedule-parser.js";
import { loadFromFile, persistToFile } from "./scheduler-store.js";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

let testDir: string;
let filePath: string;

beforeEach(() => {
  testDir = join(tmpdir(), `scheduler-store-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
  filePath = join(testDir, "schedule.json");
});

afterEach(() => {
  // intentionally left empty — tmpdir is cleaned by the OS eventually
});

function makeItem(
  id: number,
  status: ScheduledItem["status"],
  firedAt?: string,
): ScheduledItem {
  return {
    id,
    description: `item-${id}`,
    triggerAt: "2026-01-01T00:00:00Z",
    status,
    created: "2026-01-01T00:00:00Z",
    ...(firedAt ? { firedAt } : {}),
  };
}

// ---------------------------------------------------------------------------
// loadFromFile
// ---------------------------------------------------------------------------

describe("loadFromFile — file does not exist", () => {
  it("returns empty items and nextId=1", () => {
    const result = loadFromFile(join(testDir, "missing.json"), "proj");
    expect(result).toEqual({ items: [], nextId: 1 });
  });
});

describe("loadFromFile — corrupt JSON", () => {
  it("returns empty items and nextId=1", () => {
    const p = join(testDir, "corrupt.json");
    writeFileSync(p, "not json", "utf-8");
    const result = loadFromFile(p, "proj");
    expect(result).toEqual({ items: [], nextId: 1 });
  });
});

describe("loadFromFile — project mismatch", () => {
  it("returns empty items and nextId=1 when stored project differs", () => {
    persistToFile(filePath, "other-project", [makeItem(1, "pending")], 2);
    const result = loadFromFile(filePath, "my-project");
    expect(result).toEqual({ items: [], nextId: 1 });
  });
});

describe("loadFromFile — valid file", () => {
  it("returns stored items and nextId", () => {
    const items = [makeItem(1, "pending"), makeItem(2, "fired", "2026-01-02T00:00:00Z")];
    persistToFile(filePath, "proj", items, 3);
    const result = loadFromFile(filePath, "proj");
    expect(result.items).toHaveLength(2);
    expect(result.nextId).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// persistToFile — cleanup logic
// ---------------------------------------------------------------------------

describe("persistToFile — removes cancelled items", () => {
  it("strips cancelled items from the returned list and the file", () => {
    const items = [
      makeItem(1, "pending"),
      makeItem(2, "cancelled"),
      makeItem(3, "fired", "2026-01-01T01:00:00Z"),
    ];
    const clean = persistToFile(filePath, "proj", items, 4);
    expect(clean.map((i) => i.id)).toEqual([1, 3]);

    const fromDisk = loadFromFile(filePath, "proj");
    expect(fromDisk.items.map((i) => i.id)).toEqual([1, 3]);
  });
});

describe("persistToFile — caps fired items at 20", () => {
  it("removes the oldest fired items beyond the limit", () => {
    // 25 fired items, ordered by firedAt ascending: "2026-01-01T00:00:01Z" ... "2026-01-01T00:00:25Z"
    const fired: ScheduledItem[] = Array.from({ length: 25 }, (_, i) =>
      makeItem(i + 1, "fired", `2026-01-01T00:00:${String(i + 1).padStart(2, "0")}Z`),
    );
    const clean = persistToFile(filePath, "proj", fired, 26);

    // Only 20 should remain
    expect(clean).toHaveLength(20);
    // The 5 oldest (ids 1–5) should have been dropped
    const ids = clean.map((i) => i.id);
    for (let id = 1; id <= 5; id++) {
      expect(ids).not.toContain(id);
    }
    for (let id = 6; id <= 25; id++) {
      expect(ids).toContain(id);
    }
  });

  it("does not trim when fired count equals MAX_FIRED exactly", () => {
    const fired: ScheduledItem[] = Array.from({ length: 20 }, (_, i) =>
      makeItem(i + 1, "fired", `2026-01-01T00:00:${String(i + 1).padStart(2, "0")}Z`),
    );
    const clean = persistToFile(filePath, "proj", fired, 21);
    expect(clean).toHaveLength(20);
  });
});

describe("persistToFile — null filePath", () => {
  it("returns cleaned items without writing any file", () => {
    const items = [makeItem(1, "pending"), makeItem(2, "cancelled")];
    const clean = persistToFile(null, "proj", items, 3);
    expect(clean.map((i) => i.id)).toEqual([1]);
    expect(existsSync(filePath)).toBe(false);
  });
});

describe("persistToFile — event-trigger round-trip", () => {
  it("preserves triggerEvent, triggerFilter, and repeat through save/load", () => {
    const eventItem: ScheduledItem = {
      id: 1,
      description: "On build complete",
      triggerAt: "2026-01-01T00:00:00Z",
      triggerEvent: "workflow.completed",
      triggerFilter: { workflow: "builder" },
      repeat: true,
      status: "pending",
      created: "2026-01-01T00:00:00Z",
    };
    const timeItem: ScheduledItem = {
      id: 2,
      description: "Morning check",
      triggerAt: "2026-01-02T09:00:00Z",
      status: "pending",
      created: "2026-01-01T00:00:00Z",
    };
    persistToFile(filePath, "proj", [eventItem, timeItem], 3);
    const result = loadFromFile(filePath, "proj");

    expect(result.items).toHaveLength(2);
    const loaded = result.items.find((i) => i.id === 1)!;
    expect(loaded.triggerEvent).toBe("workflow.completed");
    expect(loaded.triggerFilter).toEqual({ workflow: "builder" });
    expect(loaded.repeat).toBe(true);

    const loadedTime = result.items.find((i) => i.id === 2)!;
    expect(loadedTime.triggerEvent).toBeUndefined();
    expect(loadedTime.triggerFilter).toBeUndefined();
    expect(loadedTime.repeat).toBeUndefined();
  });

  it("preserves one-shot event trigger (no repeat field)", () => {
    const item: ScheduledItem = {
      id: 1,
      description: "Once on session end",
      triggerAt: "2026-01-01T00:00:00Z",
      triggerEvent: "session.end",
      status: "pending",
      created: "2026-01-01T00:00:00Z",
    };
    persistToFile(filePath, "proj", [item], 2);
    const result = loadFromFile(filePath, "proj");
    const loaded = result.items[0];
    expect(loaded.triggerEvent).toBe("session.end");
    expect(loaded.repeat).toBeUndefined();
  });
});

describe("persistToFile — creates parent directory", () => {
  it("writes successfully even when the directory does not exist", () => {
    const nested = join(testDir, "a", "b", "c", "schedule.json");
    persistToFile(nested, "proj", [makeItem(1, "pending")], 2);
    expect(existsSync(nested)).toBe(true);
    const raw = JSON.parse(readFileSync(nested, "utf-8"));
    expect(raw.project).toBe("proj");
    expect(raw.items).toHaveLength(1);
  });
});
