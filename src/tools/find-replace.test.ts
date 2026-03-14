import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  mkdirSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runFindReplace, applyReplacement } from "./find-replace.js";

// --- Unit tests for applyReplacement ---

describe("applyReplacement", () => {
  it("replaces all literal occurrences", () => {
    const r = applyReplacement("foo bar foo baz foo", "foo", "qux", false, false);
    expect(r.count).toBe(3);
    expect(r.result).toBe("qux bar qux baz qux");
  });

  it("word boundary avoids partial matches", () => {
    const r = applyReplacement("foo foobar barfoo foo", "foo", "baz", false, true);
    expect(r.count).toBe(2);
    expect(r.result).toBe("baz foobar barfoo baz");
  });

  it("regex with capture groups", () => {
    const r = applyReplacement(
      "getName() getAge()",
      "get(\\w+)",
      "fetch$1",
      true,
      false,
    );
    expect(r.count).toBe(2);
    expect(r.result).toBe("fetchName() fetchAge()");
  });

  it("literal mode preserves $ in replacement", () => {
    const r = applyReplacement("price: X", "X", "$100", false, false);
    expect(r.count).toBe(1);
    expect(r.result).toBe("price: $100");
  });

  it("word boundary + literal preserves $ in replacement", () => {
    const r = applyReplacement("cost is X here", "X", "$5", false, true);
    expect(r.count).toBe(1);
    expect(r.result).toBe("cost is $5 here");
  });

  it("returns count 0 when pattern not found", () => {
    const r = applyReplacement("hello world", "xyz", "abc", false, false);
    expect(r.count).toBe(0);
    expect(r.result).toBe("hello world");
  });

  it("handles empty replacement (deletion)", () => {
    const r = applyReplacement("hello world", " world", "", false, false);
    expect(r.count).toBe(1);
    expect(r.result).toBe("hello");
  });
});

// --- Integration tests for runFindReplace ---

describe("runFindReplace", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "fr-test-"));
    mkdirSync(join(dir, "sub"), { recursive: true });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("replaces across multiple files", async () => {
    writeFileSync(join(dir, "a.txt"), "hello world");
    writeFileSync(join(dir, "b.txt"), "hello there");
    writeFileSync(join(dir, "c.txt"), "goodbye world");

    const result = await runFindReplace({
      pattern: "hello",
      replacement: "hi",
      files: join(dir, "*.txt"),
    });

    expect(result.is_error).toBeUndefined();
    expect(result.content).toContain("2 file(s)");
    expect(readFileSync(join(dir, "a.txt"), "utf-8")).toBe("hi world");
    expect(readFileSync(join(dir, "b.txt"), "utf-8")).toBe("hi there");
    // c.txt should be unchanged (no match)
    expect(readFileSync(join(dir, "c.txt"), "utf-8")).toBe("goodbye world");
  });

  it("dry run shows preview without modifying", async () => {
    writeFileSync(join(dir, "a.txt"), "hello world");

    const result = await runFindReplace({
      pattern: "hello",
      replacement: "hi",
      files: join(dir, "*.txt"),
      dry_run: true,
    });

    expect(result.content).toContain("Dry run");
    expect(result.content).toContain("1 match(es)");
    expect(readFileSync(join(dir, "a.txt"), "utf-8")).toBe("hello world");
  });

  it("returns error when no files match glob", async () => {
    const result = await runFindReplace({
      pattern: "hello",
      replacement: "hi",
      files: join(dir, "*.xyz"),
    });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("No files match");
  });

  it("returns message when pattern not found in files", async () => {
    writeFileSync(join(dir, "a.txt"), "hello world");

    const result = await runFindReplace({
      pattern: "xyz",
      replacement: "abc",
      files: join(dir, "*.txt"),
    });

    expect(result.is_error).toBeUndefined();
    expect(result.content).toContain("No matches");
  });

  it("reverts all changes on lint failure", async () => {
    writeFileSync(join(dir, "good.json"), '{"key": "value"}');
    writeFileSync(join(dir, "bad.json"), '{"name": "value"}');

    const result = await runFindReplace({
      pattern: '"value"',
      replacement: 'value"broken',
      files: join(dir, "*.json"),
    });

    expect(result.is_error).toBe(true);
    expect(result.content).toContain("reverted");
    // Both files should be unchanged
    expect(readFileSync(join(dir, "good.json"), "utf-8")).toBe('{"key": "value"}');
    expect(readFileSync(join(dir, "bad.json"), "utf-8")).toBe('{"name": "value"}');
  });

  it("validates required parameters", async () => {
    const r1 = await runFindReplace({
      pattern: "",
      replacement: "hi",
      files: "*.txt",
    });
    expect(r1.is_error).toBe(true);

    const r2 = await runFindReplace({
      pattern: "x",
      replacement: "y",
      files: "",
    });
    expect(r2.is_error).toBe(true);
  });

  it("rejects invalid regex", async () => {
    const result = await runFindReplace({
      pattern: "[invalid",
      replacement: "x",
      files: join(dir, "*.txt"),
      is_regex: true,
    });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("invalid regex");
  });

  it("applies word boundary matching across files", async () => {
    writeFileSync(join(dir, "a.txt"), "foo foobar barfoo foo");

    const result = await runFindReplace({
      pattern: "foo",
      replacement: "baz",
      files: join(dir, "*.txt"),
      word_boundary: true,
    });

    expect(result.is_error).toBeUndefined();
    expect(readFileSync(join(dir, "a.txt"), "utf-8")).toBe(
      "baz foobar barfoo baz",
    );
  });

  it("searches subdirectories with ** glob", async () => {
    writeFileSync(join(dir, "root.txt"), "hello");
    writeFileSync(join(dir, "sub", "nested.txt"), "hello");

    const result = await runFindReplace({
      pattern: "hello",
      replacement: "hi",
      files: join(dir, "**/*.txt"),
    });

    expect(result.is_error).toBeUndefined();
    expect(result.content).toContain("2 file(s)");
    expect(readFileSync(join(dir, "root.txt"), "utf-8")).toBe("hi");
    expect(readFileSync(join(dir, "sub", "nested.txt"), "utf-8")).toBe("hi");
  });
});
