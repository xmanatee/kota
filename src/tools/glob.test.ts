import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  mkdtempSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  utimesSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runGlob } from "./glob.js";

describe("runGlob", () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "glob-test-"));

    writeFileSync(join(dir, "old.ts"), "// old");
    utimesSync(join(dir, "old.ts"), new Date("2020-01-01"), new Date("2020-01-01"));

    writeFileSync(join(dir, "mid.ts"), "// mid");
    utimesSync(join(dir, "mid.ts"), new Date("2022-06-15"), new Date("2022-06-15"));

    writeFileSync(join(dir, "new.ts"), "// new");
    utimesSync(join(dir, "new.ts"), new Date("2025-01-01"), new Date("2025-01-01"));

    writeFileSync(join(dir, "other.js"), "// js file");

    // Ignored directories
    mkdirSync(join(dir, "node_modules"), { recursive: true });
    writeFileSync(join(dir, "node_modules", "dep.ts"), "");

    mkdirSync(join(dir, "dist"), { recursive: true });
    writeFileSync(join(dir, "dist", "out.ts"), "");

    // Nested file
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src", "index.ts"), "// src");
    utimesSync(
      join(dir, "src", "index.ts"),
      new Date("2024-06-01"),
      new Date("2024-06-01"),
    );
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns error when pattern is empty", async () => {
    const result = await runGlob({ pattern: "" });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("pattern is required");
  });

  it("returns 'No files matched' for non-matching pattern", async () => {
    const result = await runGlob({ pattern: "**/*.xyz", path: dir });
    expect(result.content).toBe("No files matched.");
  });

  it("finds files matching a glob pattern", async () => {
    const result = await runGlob({ pattern: "**/*.ts", path: dir });
    expect(result.content).toContain("old.ts");
    expect(result.content).toContain("mid.ts");
    expect(result.content).toContain("new.ts");
    expect(result.content).toContain("src/index.ts");
  });

  it("sorts results by mtime newest first", async () => {
    const result = await runGlob({ pattern: "**/*.ts", path: dir });
    const lines = result.content.split("\n");
    const newIdx = lines.findIndex((l) => l.includes("new.ts"));
    const midIdx = lines.findIndex((l) => l.includes("mid.ts"));
    const oldIdx = lines.findIndex((l) => l.includes("old.ts"));
    expect(newIdx).toBeLessThan(midIdx);
    expect(midIdx).toBeLessThan(oldIdx);
  });

  it("ignores node_modules and dist directories", async () => {
    const result = await runGlob({ pattern: "**/*.ts", path: dir });
    expect(result.content).not.toContain("dep.ts");
    expect(result.content).not.toContain("out.ts");
  });

  it("respects max_results limit", async () => {
    const result = await runGlob({
      pattern: "**/*.ts",
      path: dir,
      max_results: 2,
    });
    const tsLines = result.content
      .split("\n")
      .filter((l) => l.includes(".ts"));
    expect(tsLines).toHaveLength(2);
    expect(result.content).toContain("Showing 2 of");
  });

  it("returns newest files when limited by max_results", async () => {
    const result = await runGlob({
      pattern: "**/*.ts",
      path: dir,
      max_results: 2,
    });
    // Newest 2: new.ts (2025) and src/index.ts (2024)
    expect(result.content).toContain("new.ts");
    expect(result.content).toContain("src/index.ts");
    expect(result.content).not.toContain("old.ts");
  });

  it("no truncation message when all results fit", async () => {
    const result = await runGlob({ pattern: "**/*.ts", path: dir });
    expect(result.content).not.toContain("Showing");
  });

  it("finds files with different extensions", async () => {
    const result = await runGlob({ pattern: "**/*.js", path: dir });
    expect(result.content).toContain("other.js");
    expect(result.content).not.toContain(".ts");
  });

  it("uses current directory as default path without crashing", async () => {
    const result = await runGlob({
      pattern: "*.nonexistent-extension-xyz",
    });
    expect(result.content).toBe("No files matched.");
  });
});
