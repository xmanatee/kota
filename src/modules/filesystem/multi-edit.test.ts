import { linkSync, mkdirSync, readFileSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { checkFreshness, recordRead } from "#core/file-tracking/file-tracker.js";
import { initChangeTracker, resetChangeTracker } from "#core/loop/file-changes.js";
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
  it("applies and displays a small edit in a large file", async () => {
    const content = Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n");
    const path = writeTemp("single.txt", content);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      const result = await runMultiEdit({
        edits: [{ path, old_string: "line 15", new_string: "updated line" }],
      });
      expect(result.is_error).toBeUndefined();
      expect(result.content).toContain("1 edit(s)");
      expect(readTemp("single.txt")).toBe(content.replace("line 15", "updated line"));
      const output = stderr.mock.calls.map(([text]) => text).join("");
      expect(output).toContain("-line 15");
      expect(output).toContain("+updated line");
      expect(output).not.toContain("replaced 30 lines");
    } finally {
      stderr.mockRestore();
    }
  });

  it.each([
    { kind: "symlink", link: symlinkSync },
    { kind: "hardlink", link: linkSync },
  ])("applies dependent edits to the same file through a $kind alias", async ({ kind, link }) => {
    const filename = `multi-same-${kind}.txt`;
    const path = writeTemp(filename, "aaa bbb ccc");
    const alias = join(TEST_DIR, `alias-${kind}.txt`);
    link(path, alias);
    const result = await runMultiEdit(
      {
        edits: [
          { path: filename, old_string: "aaa", new_string: "xxx" },
          { path: alias, old_string: "xxx bbb", new_string: "xxx yyy" },
        ],
      },
      { cwd: TEST_DIR },
    );
    expect(result.is_error).toBeUndefined();
    expect(result.content).toContain("2 edit(s)");
    expect(result.content).toContain("1 file(s)");
    expect(readFileSync(path, "utf-8")).toBe("xxx yyy ccc");
    expect(readFileSync(alias, "utf-8")).toBe("xxx yyy ccc");
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
    expect(result.content).toContain("No files changed");
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

describe("multi_edit: preparation failures", () => {
  it("leaves files untouched when a later edit fails to find old_string", async () => {
    const path1 = writeTemp("atom-a.txt", "alpha");
    const path2 = writeTemp("atom-b.txt", "beta");
    utimesSync(path1, 1, 1);
    const before = statSync(path1);

    const result = await runMultiEdit({
      edits: [
        { path: path1, old_string: "alpha", new_string: "ALPHA" },
        { path: path2, old_string: "MISSING", new_string: "replaced" },
      ],
    });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("edit[1]");
    expect(result.content).toContain("not found");
    expect(result.content).toContain("No files changed");
    expect(readTemp("atom-a.txt")).toBe("alpha");
    expect(readTemp("atom-b.txt")).toBe("beta");
    expect(statSync(path1).mtimeMs).toBe(before.mtimeMs);
  });

  it("leaves files untouched when ambiguous match is found", async () => {
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
    expect(readTemp("atom-ambig-a.txt")).toBe("first");
    expect(readTemp("atom-ambig-b.txt")).toBe("dup dup");
  });
});

describe("multi_edit: final content", () => {
  it("keeps edits even when final syntax is unfinished", async () => {
    const pathTxt = writeTemp("lint-ok.txt", "text content");
    const pathJson = writeTemp("lint-fail.json", '{"key": "value"}');

    const result = await runMultiEdit({
      edits: [
        { path: pathTxt, old_string: "text", new_string: "changed" },
        { path: pathJson, old_string: '"value"', new_string: '"value",,,' },
      ],
    });
    expect(result.is_error).toBeUndefined();
    expect(readTemp("lint-ok.txt")).toBe("changed content");
    expect(readTemp("lint-fail.json")).toBe('{"key": "value",,,}');
  });

  it("applies dependent edits through invalid intermediate syntax and tracks the original once", async () => {
    const pathJson = writeTemp("stale-multi.json", '{"key": "value"}');
    recordRead(pathJson);
    const tracker = initChangeTracker();
    try {
      const result = await runMultiEdit({
        edits: [
          { path: pathJson, old_string: '"value"', new_string: '"value",,,' },
          { path: pathJson, old_string: '"value",,,', new_string: '"finished"' },
        ],
      });
      expect(result.is_error).toBeUndefined();
      expect(readTemp("stale-multi.json")).toBe('{"key": "finished"}');
      expect(checkFreshness(pathJson)).toBeNull();
      expect(tracker.getTrackedFiles()).toEqual([
        { path: pathJson, changeCount: 1, isNew: false, lastTool: "multi_edit" },
      ]);
      expect(tracker.restore(pathJson).success).toBe(true);
      expect(readTemp("stale-multi.json")).toBe('{"key": "value"}');
    } finally {
      resetChangeTracker();
    }
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

  it("treats replacement strings literally with and without replace_all", async () => {
    const path = writeTemp("literal.txt", "first second second");
    const replacement = "$& $$ $` $'";
    const result = await runMultiEdit({
      edits: [
        { path, old_string: "first", new_string: replacement },
        { path, old_string: "second", new_string: replacement, replace_all: true },
      ],
    });
    expect(result.is_error).toBeUndefined();
    expect(readTemp("literal.txt")).toBe(Array(3).fill(replacement).join(" "));
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
