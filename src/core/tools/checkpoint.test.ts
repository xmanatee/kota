import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initChangeTracker, resetChangeTracker } from "../loop/file-changes.js";
import { runCheckpoint } from "./checkpoint.js";

describe("checkpoint tool", () => {
  let dir: string;

  beforeEach(() => {
    dir = join(tmpdir(), `kota-checkpoint-test-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    initChangeTracker();
  });

  afterEach(() => {
    resetChangeTracker();
    rmSync(dir, { recursive: true, force: true });
  });

  describe("list action", () => {
    it("returns empty message when no changes", async () => {
      const result = await runCheckpoint({ action: "list" });
      expect(result.content).toContain("No file changes");
    });

    it("lists tracked files with change counts", async () => {
      const tracker = initChangeTracker();
      const path = join(dir, "test.ts");
      writeFileSync(path, "modified", "utf-8");
      tracker.recordChange(path, "original", "file_edit");
      tracker.recordChange(path, "v2", "file_edit");

      const result = await runCheckpoint({ action: "list" });
      expect(result.content).toContain("2 change(s)");
      expect(result.content).toContain(path);
      expect(result.content).toContain("file_edit");
    });

    it("marks new files", async () => {
      const tracker = initChangeTracker();
      const path = join(dir, "new.ts");
      writeFileSync(path, "content", "utf-8");
      tracker.recordChange(path, null, "file_write");

      const result = await runCheckpoint({ action: "list" });
      expect(result.content).toContain("[new]");
    });
  });

  describe("diff action", () => {
    it("requires path parameter", async () => {
      const result = await runCheckpoint({ action: "diff" });
      expect(result.is_error).toBe(true);
      expect(result.content).toContain("path is required");
    });

    it("returns error for untracked file", async () => {
      const result = await runCheckpoint({ action: "diff", path: "/tmp/nope.ts" });
      expect(result.is_error).toBe(true);
      expect(result.content).toContain("not tracked");
    });

    it("shows diff for modified file", async () => {
      const tracker = initChangeTracker();
      const path = join(dir, "mod.ts");
      writeFileSync(path, "new content\n", "utf-8");
      tracker.recordChange(path, "old content\n", "file_edit");

      const result = await runCheckpoint({ action: "diff", path });
      expect(result.content).toContain("- old content");
      expect(result.content).toContain("+ new content");
    });

    it("shows new file diff", async () => {
      const tracker = initChangeTracker();
      const path = join(dir, "new.ts");
      writeFileSync(path, "line1\nline2\n", "utf-8");
      tracker.recordChange(path, null, "file_write");

      const result = await runCheckpoint({ action: "diff", path });
      expect(result.content).toContain("[New file:");
      expect(result.content).toContain("+ line1");
    });
  });

  describe("restore action", () => {
    it("requires path parameter", async () => {
      const result = await runCheckpoint({ action: "restore" });
      expect(result.is_error).toBe(true);
      expect(result.content).toContain("path is required");
    });

    it("restores file to original content", async () => {
      const tracker = initChangeTracker();
      const path = join(dir, "restore.ts");
      writeFileSync(path, "modified", "utf-8");
      tracker.recordChange(path, "original", "file_edit");

      const result = await runCheckpoint({ action: "restore", path });
      expect(result.content).toContain("Restored");
      expect(readFileSync(path, "utf-8")).toBe("original");
    });

    it("returns error for untracked file", async () => {
      const result = await runCheckpoint({ action: "restore", path: "/tmp/nope.ts" });
      expect(result.is_error).toBe(true);
    });
  });

  describe("restore_all action", () => {
    it("returns message when no changes", async () => {
      const result = await runCheckpoint({ action: "restore_all" });
      expect(result.content).toContain("No file changes");
    });

    it("restores all tracked files", async () => {
      const tracker = initChangeTracker();
      const pathA = join(dir, "a.ts");
      const pathB = join(dir, "b.ts");
      writeFileSync(pathA, "a-mod", "utf-8");
      writeFileSync(pathB, "b-mod", "utf-8");
      tracker.recordChange(pathA, "a-orig", "file_edit");
      tracker.recordChange(pathB, "b-orig", "file_write");

      const result = await runCheckpoint({ action: "restore_all" });
      expect(result.content).toContain("Restored 2 file(s)");
      expect(readFileSync(pathA, "utf-8")).toBe("a-orig");
      expect(readFileSync(pathB, "utf-8")).toBe("b-orig");
    });
  });

  describe("unknown action", () => {
    it("returns error", async () => {
      const result = await runCheckpoint({ action: "invalid" });
      expect(result.is_error).toBe(true);
      expect(result.content).toContain("Unknown action");
    });
  });

  describe("when tracker not initialized", () => {
    it("returns error", async () => {
      resetChangeTracker();
      const result = await runCheckpoint({ action: "list" });
      expect(result.is_error).toBe(true);
      expect(result.content).toContain("not active");
    });
  });
});
