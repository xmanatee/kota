import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findProjectContextFiles, loadProjectContext } from "./project-context.js";

const TEST_ROOT = join(process.cwd(), ".test-project-context");
const CHILD = join(TEST_ROOT, "level1");
const GRANDCHILD = join(TEST_ROOT, "level1", "level2");

beforeAll(() => {
  mkdirSync(GRANDCHILD, { recursive: true });
});

afterAll(() => {
  rmSync(TEST_ROOT, { recursive: true, force: true });
});

describe("findProjectContextFiles", () => {
  it("finds .kota.md in the start directory", () => {
    writeFileSync(join(TEST_ROOT, ".kota.md"), "root context", "utf-8");
    try {
      const files = findProjectContextFiles(TEST_ROOT, TEST_ROOT);
      expect(files.length).toBeGreaterThanOrEqual(1);
      expect(files.some((f) => f.path === join(TEST_ROOT, ".kota.md"))).toBe(true);
      expect(files.find((f) => f.path === join(TEST_ROOT, ".kota.md"))!.content).toBe("root context");
    } finally {
      rmSync(join(TEST_ROOT, ".kota.md"), { force: true });
    }
  });

  it("returns files root-first (outermost ancestor first)", () => {
    writeFileSync(join(TEST_ROOT, ".kota.md"), "parent context", "utf-8");
    writeFileSync(join(CHILD, ".kota.md"), "child context", "utf-8");
    try {
      const files = findProjectContextFiles(CHILD, TEST_ROOT);
      const parentIdx = files.findIndex((f) => f.content === "parent context");
      const childIdx = files.findIndex((f) => f.content === "child context");
      expect(parentIdx).toBeLessThan(childIdx);
    } finally {
      rmSync(join(TEST_ROOT, ".kota.md"), { force: true });
      rmSync(join(CHILD, ".kota.md"), { force: true });
    }
  });

  it("skips empty .kota.md files", () => {
    writeFileSync(join(TEST_ROOT, ".kota.md"), "", "utf-8");
    writeFileSync(join(CHILD, ".kota.md"), "   ", "utf-8");
    try {
      const files = findProjectContextFiles(CHILD, TEST_ROOT);
      const fromTestRoot = files.filter(
        (f) => f.path === join(TEST_ROOT, ".kota.md") || f.path === join(CHILD, ".kota.md"),
      );
      expect(fromTestRoot).toHaveLength(0);
    } finally {
      rmSync(join(TEST_ROOT, ".kota.md"), { force: true });
      rmSync(join(CHILD, ".kota.md"), { force: true });
    }
  });

  it("returns empty array when no .kota.md files exist", () => {
    const files = findProjectContextFiles(GRANDCHILD, TEST_ROOT);
    expect(files).toHaveLength(0);
  });

  it("does not climb above the declared repo root", () => {
    writeFileSync(join(TEST_ROOT, ".kota.md"), "repo context", "utf-8");
    try {
      const files = findProjectContextFiles(CHILD, TEST_ROOT);
      expect(files.map((file) => file.path)).toEqual([
        join(TEST_ROOT, ".kota.md"),
      ]);
    } finally {
      rmSync(join(TEST_ROOT, ".kota.md"), { force: true });
    }
  });
});

describe("loadProjectContext", () => {
  it("returns empty string when no files found", () => {
    const result = loadProjectContext(GRANDCHILD, TEST_ROOT);
    expect(result).toBe("");
  });

  it("truncates content exceeding 8000 chars", () => {
    const longContent = "x".repeat(9000);
    writeFileSync(join(TEST_ROOT, ".kota.md"), longContent, "utf-8");
    try {
      const result = loadProjectContext(TEST_ROOT, TEST_ROOT);
      expect(result).toContain("... (truncated)");
      // The truncated content should be 8000 chars, not 9000
      const section = result.split("### ").find((s) => s.includes(TEST_ROOT));
      expect(section).toBeDefined();
      expect(section!.length).toBeLessThan(9000);
    } finally {
      rmSync(join(TEST_ROOT, ".kota.md"), { force: true });
    }
  });

  it("formats output with section headers and separators", () => {
    writeFileSync(join(TEST_ROOT, ".kota.md"), "parent rules", "utf-8");
    writeFileSync(join(CHILD, ".kota.md"), "child rules", "utf-8");
    try {
      const result = loadProjectContext(CHILD, TEST_ROOT);
      expect(result).toContain("## Project Context (from .kota.md files)");
      expect(result).toContain("parent rules");
      expect(result).toContain("child rules");
      expect(result).toContain("---");
    } finally {
      rmSync(join(TEST_ROOT, ".kota.md"), { force: true });
      rmSync(join(CHILD, ".kota.md"), { force: true });
    }
  });
});
