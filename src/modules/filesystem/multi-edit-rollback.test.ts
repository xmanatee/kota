import { mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkFreshness, recordRead } from "#core/file-tracking/file-tracker.js";
import { initChangeTracker, resetChangeTracker } from "#core/loop/file-changes.js";
import type { ToolResult } from "#core/tools/tool-result.js";
import { runFindReplace } from "./find-replace.js";
import { runMultiEdit } from "./multi-edit.js";

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return { ...actual, writeFileSync: vi.fn(actual.writeFileSync) };
});

const realWrite = (await vi.importActual<typeof import("node:fs")>("node:fs")).writeFileSync;
const mockWrite = vi.mocked(writeFileSync);
const editors: Array<{ name: string; run: (paths: string[]) => Promise<ToolResult> }> = [
  {
    name: "multi_edit",
    run: (paths) => runMultiEdit({
      edits: paths.map((path) => ({ path, old_string: "before", new_string: "after" })),
    }),
  },
  {
    name: "find_replace",
    run: (paths) => runFindReplace({
      files: join(paths[0], "..", "*.txt"), pattern: "before", replacement: "after",
    }),
  },
];

describe.each(editors)("$name write rollback", ({ name, run }) => {
  let dir: string;
  let paths: string[];

  beforeEach(() => {
    mockWrite.mockImplementation(realWrite);
    dir = mkdtempSync(join(tmpdir(), "kota-edit-rollback-"));
    paths = ["a.txt", "b.txt", "c.txt"].map((file) => join(dir, file));
    for (const path of paths) {
      writeFileSync(path, "before");
      utimesSync(path, 1, 1);
      recordRead(path);
    }
  });

  afterEach(() => {
    mockWrite.mockImplementation(realWrite);
    resetChangeTracker();
    rmSync(dir, { recursive: true, force: true });
  });

  it("restores successful and partially failed writes without touching later files", async () => {
    const tracker = initChangeTracker();
    const attempted: string[] = [];
    mockWrite.mockImplementation((path, data, options) => {
      if (data === "after") {
        attempted.push(String(path));
        if (attempted.length === 2) {
          realWrite(path, "partial", options);
          throw new Error("disk write failed");
        }
      }
      realWrite(path, data, options);
    });

    const result = await run(paths);

    expect(result.is_error).toBe(true);
    expect(result.content).toContain("disk write failed");
    expect(result.content).toMatch(/All (edits|changes) reverted/);
    for (const path of paths) {
      expect(readFileSync(path, "utf-8")).toBe("before");
      expect(checkFreshness(path)).toBeNull();
      if (!attempted.includes(path)) expect(statSync(path).mtimeMs).toBe(1000);
    }
    expect(tracker.fileCount).toBe(0);
  });

  it("reports incomplete rollback and retains undo tracking for the unrestored file", async () => {
    const tracker = initChangeTracker();
    const attempted: string[] = [];
    mockWrite.mockImplementation((path, data, options) => {
      if (data === "after") {
        attempted.push(String(path));
        if (attempted.length === 2) {
          realWrite(path, "partial", options);
          throw new Error("disk write failed");
        }
      }
      if (data === "before" && String(path) === attempted[0]) {
        throw new Error("rollback write failed");
      }
      realWrite(path, data, options);
    });

    const result = await run(paths);
    const unrestored = attempted[0];

    expect(result.is_error).toBe(true);
    expect(result.content).toContain("disk write failed");
    expect(result.content).toContain("Failed to revert");
    expect(result.content).toContain(unrestored);
    expect(result.content).not.toMatch(/All (edits|changes) reverted/);
    expect(readFileSync(unrestored, "utf-8")).toBe("after");
    for (const path of paths.filter((path) => path !== unrestored)) {
      expect(readFileSync(path, "utf-8")).toBe("before");
      if (!attempted.includes(path)) expect(statSync(path).mtimeMs).toBe(1000);
    }
    expect(tracker.getTrackedFiles()).toEqual([
      { path: unrestored, changeCount: 1, isNew: false, lastTool: name },
    ]);
    mockWrite.mockImplementation(realWrite);
    expect(tracker.restore(unrestored).success).toBe(true);
    expect(readFileSync(unrestored, "utf-8")).toBe("before");
  });
});
