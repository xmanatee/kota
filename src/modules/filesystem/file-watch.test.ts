import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { getWatcherManager, resetWatcherManager } from "#core/file-tracking/file-watcher.js";
import { runFileWatch } from "./file-watch.js";

let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "file-watch-")); });
afterEach(async () => { resetWatcherManager(); await rm(root, { recursive: true, force: true }); });

it("starts, lists and stops a scoped watch with the requested options", async () => {
  const start = await runFileWatch({ action: "start", path: ".", recursive: false, modules: [".ts"] }, { cwd: root });
  expect(start.is_error).toBeUndefined();
  const [watcher] = getWatcherManager().list();
  expect(watcher).toMatchObject({ path: root, recursive: false, modules: [".ts"] });
  expect(start.content).toContain(watcher.id);
  const list = await runFileWatch({ action: "list" });
  expect(list.content).toContain(`${watcher.id}: ${root} [.ts]`);
  expect(list.content).toContain("1 active");
  expect(await runFileWatch({ action: "stop", id: watcher.id })).toEqual({ content: `Watcher ${watcher.id} stopped.` });
  expect(await runFileWatch({ action: "list" })).toEqual({ content: "No active watchers." });
});

it.each([
  [{ action: "start" }, "path is required"],
  [{ action: "stop" }, "id is required"],
  [{ action: "stop", id: "absent" }, "not found"],
  [{ action: "invalid" }, "unknown action"],
])("rejects %j without a subscription", async (input, error) => {
  expect(await runFileWatch(input)).toMatchObject({ is_error: true, content: expect.stringContaining(error) });
  expect(getWatcherManager().list()).toEqual([]);
});
