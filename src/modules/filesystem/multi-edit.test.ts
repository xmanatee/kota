import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkFreshness, recordRead } from "#root/file-tracker.js";
import { runMultiEdit } from "./multi-edit.js";

const TEST_DIR = join(process.cwd(), ".test-multi-edit");

beforeAll(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterAll(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

function writeTemp(name: string, content: string): string {
  const path = join(TEST_DIR, name);
  writeFileSync(path, content, "utf-8");
  return path;
}

function readTemp(name: string): string {
  return readFileSync(join(TEST_DIR, name), "utf-8");
}

describe("multi_edit: validation", () => {
  it("rejects missing edits array", async () => {
    const result = await runMultiEdit({});
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("edits array is required");
  });

  it("rejects empty edits array", async () => {
    const result = await runMultiEdit({ edits: [] });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("edits array is required");
  });

  it("rejects non-array edits", async () => {
    const result = await runMultiEdit({ edits: "not-an-array" });
    expect(result.is_error).toBe(true);
  });

  it("rejects edit with missing path", async () => {
    const result = await runMultiEdit({
      edits: [{ old_string: "a", new_string: "b" }],
    });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("edit[0] missing required fields");
  });

  it("rejects edit with missing old_string", async () => {
    const path = writeTemp("val-missing-old.txt", "hello");
    const result = await runMultiEdit({
      edits: [{ path, new_string: "b" }],
    });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("edit[0] missing required fields");
  });

  it("rejects edit where old_string equals new_string", async () => {
    const path = writeTemp("val-same.txt", "hello");
    const result = await runMultiEdit({
      edits: [{ path, old_string: "hello", new_string: "hello" }],
    });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("identical");
  });

  it("rejects edit to nonexistent file", async () => {
    const result = await runMultiEdit({
      edits: [{ path: join(TEST_DIR, "nope.txt"), old_string: "a", new_string: "b" }],
    });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("file not found");
  });
});

describe("multi_edit: single file edits", () => {
  it("applies a single edit", async () => {
    const path = writeTemp("single.txt", "hello world");
    const result = await runMultiEdit({
      edits: [{ path, old_string: "hello", new_string: "goodbye" }],
    });
    expect(result.is_error).toBeUndefined();
    expect(result.content).toContain("1 edit(s)");
    expect(readTemp("single.txt")).toBe("goodbye world");
  });

  it("applies multiple edits to the same file sequentially", async () => {
    const path = writeTemp("multi-same.txt", "aaa bbb ccc");
    const result = await runMultiEdit({
      edits: [
        { path, old_string: "aaa", new_string: "xxx" },
        { path, old_string: "bbb", new_string: "yyy" },
      ],
    });
    expect(result.is_error).toBeUndefined();
    expect(result.content).toContain("2 edit(s)");
    expect(result.content).toContain("1 file(s)");
    expect(readTemp("multi-same.txt")).toBe("xxx yyy ccc");
  });
});

describe("multi_edit: multiple files", () => {
  it("applies edits across two files", async () => {
    const path1 = writeTemp("cross-a.txt", "file one content");
    const path2 = writeTemp("cross-b.txt", "file two content");
    const result = await runMultiEdit({
      edits: [
        { path: path1, old_string: "one", new_string: "ONE" },
        { path: path2, old_string: "two", new_string: "TWO" },
      ],
    });
    expect(result.is_error).toBeUndefined();
    expect(result.content).toContain("2 edit(s)");
    expect(result.content).toContain("2 file(s)");
    expect(readTemp("cross-a.txt")).toBe("file ONE content");
    expect(readTemp("cross-b.txt")).toBe("file TWO content");
  });
});

describe("multi_edit: replace_all", () => {
  it("rejects ambiguous match without replace_all", async () => {
    const path = writeTemp("ambig.txt", "cat cat cat");
    const result = await runMultiEdit({
      edits: [{ path, old_string: "cat", new_string: "dog" }],
    });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("3 times");
    expect(result.content).toContain("reverted");
    expect(readTemp("ambig.txt")).toBe("cat cat cat");
  });

  it("replaces all occurrences with replace_all flag", async () => {
    const path = writeTemp("replace-all.txt", "cat cat cat");
    const result = await runMultiEdit({
      edits: [{ path, old_string: "cat", new_string: "dog", replace_all: true }],
    });
    expect(result.is_error).toBeUndefined();
    expect(readTemp("replace-all.txt")).toBe("dog dog dog");
  });
});

describe("multi_edit: atomicity (rollback)", () => {
  it("reverts all edits when a later edit fails to find old_string", async () => {
    const path1 = writeTemp("atom-a.txt", "alpha");
    const path2 = writeTemp("atom-b.txt", "beta");

    const result = await runMultiEdit({
      edits: [
        { path: path1, old_string: "alpha", new_string: "ALPHA" },
        { path: path2, old_string: "MISSING", new_string: "replaced" },
      ],
    });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("edit[1]");
    expect(result.content).toContain("not found");
    // First file should be reverted
    expect(readTemp("atom-a.txt")).toBe("alpha");
    expect(readTemp("atom-b.txt")).toBe("beta");
  });

  it("reverts all edits when ambiguous match is found", async () => {
    const path1 = writeTemp("atom-ambig-a.txt", "first");
    const path2 = writeTemp("atom-ambig-b.txt", "dup dup");

    const result = await runMultiEdit({
      edits: [
        { path: path1, old_string: "first", new_string: "FIRST" },
        { path: path2, old_string: "dup", new_string: "single" },
      ],
    });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("2 times");
    // First file should be reverted
    expect(readTemp("atom-ambig-a.txt")).toBe("first");
    expect(readTemp("atom-ambig-b.txt")).toBe("dup dup");
  });
});

describe("multi_edit: lint-gated rollback", () => {
  it("reverts all edits when a JSON edit produces invalid syntax", async () => {
    const pathTxt = writeTemp("lint-ok.txt", "text content");
    const pathJson = writeTemp("lint-fail.json", '{"key": "value"}');

    const result = await runMultiEdit({
      edits: [
        { path: pathTxt, old_string: "text", new_string: "changed" },
        { path: pathJson, old_string: '"value"', new_string: '"value",,,' },
      ],
    });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("syntax error");
    expect(result.content).toContain("reverted");
    // Both files should be restored
    expect(readTemp("lint-ok.txt")).toBe("text content");
    expect(readTemp("lint-fail.json")).toBe('{"key": "value"}');
  });

  it("no false stale warning after lint-reverted multi-edit", async () => {
    const pathJson = writeTemp("stale-multi.json", '{"key": "value"}');
    recordRead(pathJson);

    const result = await runMultiEdit({
      edits: [
        { path: pathJson, old_string: '"value"', new_string: '"value",,,' },
      ],
    });
    expect(result.is_error).toBe(true);
    expect(readTemp("stale-multi.json")).toBe('{"key": "value"}');

    // File tracker should be up-to-date after revert
    expect(checkFreshness(pathJson)).toBeNull();
  });
});

describe("multi_edit: edge cases", () => {
  it("handles edit that creates an empty string replacement", async () => {
    const path = writeTemp("empty-replace.txt", "remove-me rest");
    const result = await runMultiEdit({
      edits: [{ path, old_string: "remove-me ", new_string: "" }],
    });
    expect(result.is_error).toBeUndefined();
    expect(readTemp("empty-replace.txt")).toBe("rest");
  });

  it("handles sequential edits where second depends on first", async () => {
    // First edit changes "hello" to "hi", second edit changes "hi world" to "hi earth"
    const path = writeTemp("chain.txt", "hello world");
    const result = await runMultiEdit({
      edits: [
        { path, old_string: "hello", new_string: "hi" },
        { path, old_string: "hi world", new_string: "hi earth" },
      ],
    });
    expect(result.is_error).toBeUndefined();
    expect(readTemp("chain.txt")).toBe("hi earth");
  });

  it("validates all edits before applying any", async () => {
    // Second edit references a nonexistent file — should fail in validation
    const path = writeTemp("pre-val.txt", "ok content");
    const result = await runMultiEdit({
      edits: [
        { path, old_string: "ok", new_string: "good" },
        { path: join(TEST_DIR, "ghost.txt"), old_string: "x", new_string: "y" },
      ],
    });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("file not found");
    // First file should NOT have been modified (validation is pre-apply)
    expect(readTemp("pre-val.txt")).toBe("ok content");
  });
});
