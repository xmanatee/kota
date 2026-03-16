import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkFreshness, recordRead } from "../file-tracker.js";
import { runFileWrite } from "./file-write.js";

const TEST_DIR = join(process.cwd(), ".test-file-write");

beforeAll(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterAll(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("file_write: validation", () => {
  it("rejects missing path", async () => {
    const result = await runFileWrite({ content: "hello" });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("path is required");
  });

  it("rejects empty path", async () => {
    const result = await runFileWrite({ path: "", content: "hello" });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("path is required");
  });

  it("rejects missing content", async () => {
    const result = await runFileWrite({ path: join(TEST_DIR, "no-content.txt") });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("content is required");
  });

  it("rejects null content", async () => {
    const result = await runFileWrite({ path: join(TEST_DIR, "null.txt"), content: null });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("content is required");
  });
});

describe("file_write: creating new files", () => {
  it("creates a new file", async () => {
    const path = join(TEST_DIR, "new-file.txt");
    const result = await runFileWrite({ path, content: "hello world" });
    expect(result.is_error).toBeUndefined();
    expect(result.content).toContain("1 lines");
    expect(readFileSync(path, "utf-8")).toBe("hello world");
  });

  it("creates a multi-line file and reports correct line count", async () => {
    const path = join(TEST_DIR, "multi-line.txt");
    const content = "line1\nline2\nline3";
    const result = await runFileWrite({ path, content });
    expect(result.is_error).toBeUndefined();
    expect(result.content).toContain("3 lines");
    expect(readFileSync(path, "utf-8")).toBe(content);
  });

  it("creates parent directories automatically", async () => {
    const path = join(TEST_DIR, "nested", "deep", "file.txt");
    const result = await runFileWrite({ path, content: "deep content" });
    expect(result.is_error).toBeUndefined();
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path, "utf-8")).toBe("deep content");
  });

  it("creates an empty file", async () => {
    const path = join(TEST_DIR, "empty.txt");
    const result = await runFileWrite({ path, content: "" });
    expect(result.is_error).toBeUndefined();
    expect(readFileSync(path, "utf-8")).toBe("");
  });
});

describe("file_write: overwriting existing files", () => {
  it("overwrites an existing file", async () => {
    const path = join(TEST_DIR, "overwrite.txt");
    writeFileSync(path, "old content", "utf-8");
    const result = await runFileWrite({ path, content: "new content" });
    expect(result.is_error).toBeUndefined();
    expect(readFileSync(path, "utf-8")).toBe("new content");
  });
});

describe("file_write: lint-gated writes", () => {
  it("reverts new file creation on JSON syntax error", async () => {
    const path = join(TEST_DIR, "bad-new.json");
    const result = await runFileWrite({ path, content: "{invalid json,,}" });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("syntax error");
    expect(result.content).toContain("reverted");
    // File should have been removed since it didn't exist before
    expect(existsSync(path)).toBe(false);
  });

  it("reverts existing file on JSON syntax error", async () => {
    const path = join(TEST_DIR, "bad-existing.json");
    writeFileSync(path, '{"valid": true}', "utf-8");
    const result = await runFileWrite({ path, content: "{broken,,}" });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("syntax error");
    // Original content should be restored
    expect(readFileSync(path, "utf-8")).toBe('{"valid": true}');
  });

  it("accepts valid JSON", async () => {
    const path = join(TEST_DIR, "good.json");
    const content = '{"name": "test", "value": 42}';
    const result = await runFileWrite({ path, content });
    expect(result.is_error).toBeUndefined();
    expect(readFileSync(path, "utf-8")).toBe(content);
  });

  it("no false stale warning after lint-reverted overwrite", async () => {
    const path = join(TEST_DIR, "stale-write.json");
    writeFileSync(path, '{"valid": true}', "utf-8");
    recordRead(path);

    // Overwrite with broken JSON — should revert
    const result = await runFileWrite({ path, content: "{broken,,}" });
    expect(result.is_error).toBe(true);
    expect(readFileSync(path, "utf-8")).toBe('{"valid": true}');

    // File tracker should be up-to-date after revert
    expect(checkFreshness(path)).toBeNull();
  });
});
