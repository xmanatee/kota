import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ChangeTracker,
  getChangeTracker,
  initChangeTracker,
  resetChangeTracker,
  trackFileChange,
} from "./file-changes.js";

describe("ChangeTracker", () => {
  let tracker: ChangeTracker;
  let dir: string;

  beforeEach(() => {
    dir = join(tmpdir(), `kota-changes-test-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    tracker = new ChangeTracker();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  describe("recordChange", () => {
    it("tracks first change to a file", () => {
      tracker.recordChange("/tmp/a.ts", "original content", "file_edit");
      expect(tracker.fileCount).toBe(1);
      expect(tracker.totalChanges).toBe(1);
      expect(tracker.isTracked("/tmp/a.ts")).toBe(true);
    });

    it("increments change count for subsequent changes", () => {
      tracker.recordChange("/tmp/a.ts", "v1", "file_edit");
      tracker.recordChange("/tmp/a.ts", "v2", "file_edit");
      tracker.recordChange("/tmp/a.ts", "v3", "file_write");

      expect(tracker.fileCount).toBe(1);
      expect(tracker.totalChanges).toBe(3);

      const files = tracker.getTrackedFiles();
      expect(files[0].changeCount).toBe(3);
      expect(files[0].lastTool).toBe("file_write");
    });

    it("preserves original content across multiple changes", () => {
      tracker.recordChange("/tmp/a.ts", "original", "file_edit");
      tracker.recordChange("/tmp/a.ts", "modified-v1", "file_edit");
      tracker.recordChange("/tmp/a.ts", "modified-v2", "file_edit");

      // The tracker should have the ORIGINAL content, not v1 or v2
      // We verify this by restoring — need a real file for that
      const path = join(dir, "test.ts");
      const realTracker = new ChangeTracker();
      writeFileSync(path, "modified-v3", "utf-8");
      realTracker.recordChange(path, "original content", "file_edit");
      realTracker.recordChange(path, "modified-v1", "file_edit");

      const result = realTracker.restore(path);
      expect(result.success).toBe(true);
      expect(readFileSync(path, "utf-8")).toBe("original content");
    });

    it("tracks multiple files independently", () => {
      tracker.recordChange("/tmp/a.ts", "a-orig", "file_edit");
      tracker.recordChange("/tmp/b.ts", "b-orig", "file_write");

      expect(tracker.fileCount).toBe(2);
      expect(tracker.totalChanges).toBe(2);
    });

    it("records null for newly created files", () => {
      tracker.recordChange("/tmp/new.ts", null, "file_write");

      const files = tracker.getTrackedFiles();
      expect(files[0].isNew).toBe(true);
    });
  });

  describe("getTrackedFiles", () => {
    it("returns empty array when nothing tracked", () => {
      expect(tracker.getTrackedFiles()).toEqual([]);
    });

    it("returns file metadata", () => {
      tracker.recordChange("/tmp/a.ts", "content", "file_edit");
      const files = tracker.getTrackedFiles();

      expect(files).toHaveLength(1);
      expect(files[0]).toMatchObject({
        path: "/tmp/a.ts",
        changeCount: 1,
        isNew: false,
        lastTool: "file_edit",
      });
    });
  });

  describe("diff", () => {
    it("returns error for untracked files", () => {
      const result = tracker.diff("/tmp/untracked.ts");
      expect(result.error).toContain("not tracked");
    });

    it("shows new file content", () => {
      const path = join(dir, "new.ts");
      writeFileSync(path, "line1\nline2\n", "utf-8");
      tracker.recordChange(path, null, "file_write");

      const result = tracker.diff(path);
      expect(result.content).toContain("[New file:");
      expect(result.content).toContain("+ line1");
      expect(result.content).toContain("+ line2");
    });

    it("shows no changes when file is unchanged", () => {
      const path = join(dir, "same.ts");
      writeFileSync(path, "content\n", "utf-8");
      tracker.recordChange(path, "content\n", "file_edit");

      const result = tracker.diff(path);
      expect(result.content).toContain("No net changes");
    });

    it("shows diff for modified file", () => {
      const path = join(dir, "mod.ts");
      writeFileSync(path, "line1\nchanged\nline3\n", "utf-8");
      tracker.recordChange(path, "line1\noriginal\nline3\n", "file_edit");

      const result = tracker.diff(path);
      expect(result.content).toContain("- original");
      expect(result.content).toContain("+ changed");
    });
  });

  describe("restore", () => {
    it("restores file to original content", () => {
      const path = join(dir, "restore.ts");
      writeFileSync(path, "modified content", "utf-8");
      tracker.recordChange(path, "original content", "file_edit");

      const result = tracker.restore(path);
      expect(result.success).toBe(true);
      expect(readFileSync(path, "utf-8")).toBe("original content");
      expect(tracker.isTracked(path)).toBe(false);
    });

    it("deletes newly created files", () => {
      const path = join(dir, "new-file.ts");
      writeFileSync(path, "new content", "utf-8");
      tracker.recordChange(path, null, "file_write");

      const result = tracker.restore(path);
      expect(result.success).toBe(true);
      expect(existsSync(path)).toBe(false);
    });

    it("returns error for untracked files", () => {
      const result = tracker.restore("/tmp/untracked.ts");
      expect(result.success).toBe(false);
      expect(result.error).toContain("not tracked");
    });

    it("removes file from tracking after restore", () => {
      const path = join(dir, "tracked.ts");
      writeFileSync(path, "current", "utf-8");
      tracker.recordChange(path, "original", "file_edit");

      tracker.restore(path);
      expect(tracker.fileCount).toBe(0);
    });
  });

  describe("restoreAll", () => {
    it("restores all tracked files", () => {
      const pathA = join(dir, "a.ts");
      const pathB = join(dir, "b.ts");
      writeFileSync(pathA, "a-modified", "utf-8");
      writeFileSync(pathB, "b-modified", "utf-8");

      tracker.recordChange(pathA, "a-original", "file_edit");
      tracker.recordChange(pathB, "b-original", "file_write");

      const result = tracker.restoreAll();
      expect(result.restored).toHaveLength(2);
      expect(result.errors).toHaveLength(0);
      expect(readFileSync(pathA, "utf-8")).toBe("a-original");
      expect(readFileSync(pathB, "utf-8")).toBe("b-original");
      expect(tracker.fileCount).toBe(0);
    });

    it("reports errors without stopping", () => {
      const path = join(dir, "ok.ts");
      writeFileSync(path, "modified", "utf-8");
      tracker.recordChange(path, "original", "file_edit");
      tracker.recordChange("/nonexistent/dir/bad.ts", "content", "file_edit");

      const result = tracker.restoreAll();
      expect(result.restored).toContain(path);
      expect(result.errors).toHaveLength(1);
    });
  });

  describe("getSummary", () => {
    it("returns empty string when nothing tracked", () => {
      expect(tracker.getSummary()).toBe("");
    });

    it("returns summary with file names", () => {
      tracker.recordChange("/tmp/a.ts", "content", "file_edit");
      tracker.recordChange("/tmp/b.ts", "content", "file_write");

      const summary = tracker.getSummary();
      expect(summary).toContain("2 file change(s)");
      expect(summary).toContain("2 file(s)");
      expect(summary).toContain("/tmp/a.ts");
      expect(summary).toContain("checkpoint");
    });

    it("truncates long file lists", () => {
      for (let i = 0; i < 12; i++) {
        tracker.recordChange(`/tmp/file${i}.ts`, "content", "file_edit");
      }
      const summary = tracker.getSummary();
      expect(summary).toContain("12 total");
    });
  });

  describe("clear", () => {
    it("removes all tracked state", () => {
      tracker.recordChange("/tmp/a.ts", "content", "file_edit");
      tracker.clear();
      expect(tracker.fileCount).toBe(0);
      expect(tracker.totalChanges).toBe(0);
    });
  });
});

describe("singleton", () => {
  afterEach(() => {
    resetChangeTracker();
  });

  it("initChangeTracker creates instance", () => {
    const tracker = initChangeTracker();
    expect(tracker).toBeInstanceOf(ChangeTracker);
    expect(getChangeTracker()).toBe(tracker);
  });

  it("getChangeTracker returns null before init", () => {
    expect(getChangeTracker()).toBeNull();
  });

  it("resetChangeTracker clears instance", () => {
    initChangeTracker();
    resetChangeTracker();
    expect(getChangeTracker()).toBeNull();
  });

  it("trackFileChange is no-op when not initialized", () => {
    // Should not throw
    trackFileChange("/tmp/test.ts", "content", "file_edit");
  });

  it("trackFileChange records on global instance", () => {
    const tracker = initChangeTracker();
    trackFileChange("/tmp/test.ts", "content", "file_edit");
    expect(tracker.fileCount).toBe(1);
  });
});
