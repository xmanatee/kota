import { mkdir, mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { initEventBus, resetEventBus } from "#core/events/event-bus.js";
import { type FileChange, WatcherManager } from "./file-watcher.js";
import { MAX_WATCHERS } from "./file-watcher-core.js";

let root: string;
let manager: WatcherManager;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "watcher-")); manager = new WatcherManager(); });
afterEach(async () => { manager.closeAll(); resetEventBus(); await rm(root, { recursive: true, force: true }); });

it("tracks distinct subscriptions and selectively stops them", async () => {
  const first = await manager.start(root, { recursive: false });
  const second = await manager.start(root, { modules: [".ts"] });
  expect(first).not.toBe(second);
  expect(manager.list()).toMatchObject([
    { id: first, path: root, recursive: false, changeCount: 0 },
    { id: second, path: root, recursive: true, modules: [".ts"], changeCount: 0 },
  ]);
  expect(manager.stop(first)).toBe(true);
  expect(manager.stop(first)).toBe(false);
  expect(manager.list().map((watcher) => watcher.id)).toEqual([second]);
  manager.closeAll();
  expect(manager.list()).toEqual([]);
});

it("rejects excess subscriptions and reuses released capacity", async () => {
  const ids: string[] = [];
  for (let i = 0; i < MAX_WATCHERS; i++) ids.push(await manager.start(root));
  await expect(manager.start(root)).rejects.toThrow("Maximum");
  expect(manager.size).toBe(MAX_WATCHERS);
  manager.stop(ids[0]);
  expect(await manager.start(root)).not.toBe(ids[0]);
  expect(manager.size).toBe(MAX_WATCHERS);
});

it("emits actual create, modify and delete changes attributed to the subscription", async () => {
  const bus = initEventBus();
  const changes: FileChange[] = [];
  const id = await manager.start(root);
  bus.on("file.changed", (event) => {
    expect(event.watchId).toBe(id);
    expect(event.path).toBe(root);
    changes.push(...event.changes);
  });
  const path = join(root, "input.txt");
  await writeFile(path, "created");
  await expect.poll(() => changes.some((change) => change.path === "input.txt" && change.type === "create"), { timeout: 3000 }).toBe(true);
  changes.length = 0;
  await writeFile(path, "modified contents");
  await expect.poll(() => changes.some((change) => change.path === "input.txt" && change.type === "change"), { timeout: 3000 }).toBe(true);
  changes.length = 0;
  await unlink(path);
  await expect.poll(() => changes.some((change) => change.path === "input.txt" && change.type === "delete"), { timeout: 3000 }).toBe(true);
  expect(manager.list()[0].changeCount).toBeGreaterThanOrEqual(3);
});

it("observes nested matching files while filtering unrelated and ignored paths", async () => {
  await mkdir(join(root, "src"));
  await mkdir(join(root, "node_modules"));
  const changes: FileChange[] = [];
  initEventBus().on("file.changed", (event) => { changes.push(...event.changes); });
  await manager.start(root, { modules: [".ts"] });
  await Promise.all([
    writeFile(join(root, "skip.txt"), "skip"),
    writeFile(join(root, "node_modules", "skip.ts"), "skip"),
    writeFile(join(root, "src", "main.ts"), "source"),
    writeFile(join(root, "src", "other.ts"), "source"),
  ]);
  await expect.poll(() => new Set(changes.map((change) => change.path)), { timeout: 3000 }).toEqual(new Set(["src/main.ts", "src/other.ts"]));
});
