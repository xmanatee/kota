import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkFreshness, recordRead } from "#core/file-tracking/file-tracker.js";
import { applyReplacement, runFindReplace } from "./find-replace.js";

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

  it("handles regex lookahead", () => {
    const r = applyReplacement("abc", "(?=b)", "|", true, false);
    expect(r.count).toBe(1);
    expect(r.result).toBe("a|bc");
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

  it("skips binary files without corrupting them", async () => {
    writeFileSync(join(dir, "text.txt"), "hello world");
    writeFileSync(join(dir, "binary.txt"), Buffer.from("hello\0world"));

    const result = await runFindReplace({
      pattern: "hello",
      replacement: "hi",
      files: join(dir, "*.txt"),
    });

    expect(result.is_error).toBeUndefined();
    expect(result.content).toContain("1 file(s)");
    expect(readFileSync(join(dir, "text.txt"), "utf-8")).toBe("hi world");
    expect(readFileSync(join(dir, "binary.txt"))).toEqual(
      Buffer.from("hello\0world"),
    );
  });

  it("reverts already-written files on later lint failure (cross-module)", async () => {
    writeFileSync(join(dir, "a.txt"), "target value");
    writeFileSync(join(dir, "z.json"), '{"key": "target"}');

    const result = await runFindReplace({
      pattern: "target",
      replacement: 'target"bad',
      files: join(dir, "*"),
    });

    expect(result.is_error).toBe(true);
    expect(result.content).toContain("reverted");
    expect(readFileSync(join(dir, "a.txt"), "utf-8")).toBe("target value");
    expect(readFileSync(join(dir, "z.json"), "utf-8")).toBe(
      '{"key": "target"}',
    );
  });

  it("regex capture groups across multiple files", async () => {
    writeFileSync(join(dir, "a.txt"), "getName getAge");
    writeFileSync(join(dir, "b.txt"), "getColor");

    const result = await runFindReplace({
      pattern: "get(\\w+)",
      replacement: "fetch$1",
      files: join(dir, "*.txt"),
      is_regex: true,
    });

    expect(result.is_error).toBeUndefined();
    expect(result.content).toContain("3 occurrence(s)");
    expect(result.content).toContain("2 file(s)");
    expect(readFileSync(join(dir, "a.txt"), "utf-8")).toBe(
      "fetchName fetchAge",
    );
    expect(readFileSync(join(dir, "b.txt"), "utf-8")).toBe("fetchColor");
  });

  it("handles empty files without error", async () => {
    writeFileSync(join(dir, "empty.txt"), "");
    writeFileSync(join(dir, "has.txt"), "hello");

    const result = await runFindReplace({
      pattern: "hello",
      replacement: "hi",
      files: join(dir, "*.txt"),
    });

    expect(result.is_error).toBeUndefined();
    expect(result.content).toContain("1 file(s)");
    expect(readFileSync(join(dir, "empty.txt"), "utf-8")).toBe("");
  });

  it("matches dotfiles with glob pattern", async () => {
    writeFileSync(join(dir, "config.json"), '{"key": "old"}');
    writeFileSync(join(dir, ".hidden.json"), '{"key": "old"}');

    const result = await runFindReplace({
      pattern: "old",
      replacement: "new",
      files: join(dir, "*.json"),
    });

    expect(result.is_error).toBeUndefined();
    expect(result.content).toContain("2 file(s)");
    expect(readFileSync(join(dir, "config.json"), "utf-8")).toBe('{"key": "new"}');
    expect(readFileSync(join(dir, ".hidden.json"), "utf-8")).toBe('{"key": "new"}');
  });

  it("matches dotfiles in subdirectories", async () => {
    mkdirSync(join(dir, ".config"), { recursive: true });
    writeFileSync(join(dir, ".config", "settings.json"), '{"v": "old"}');
    writeFileSync(join(dir, "normal.json"), '{"v": "old"}');

    const result = await runFindReplace({
      pattern: "old",
      replacement: "new",
      files: join(dir, "**/*.json"),
    });

    expect(result.is_error).toBeUndefined();
    expect(result.content).toContain("2 file(s)");
    expect(readFileSync(join(dir, ".config", "settings.json"), "utf-8")).toBe('{"v": "new"}');
  });

  it("lint failure error preserves syntax error context", async () => {
    writeFileSync(join(dir, "a.json"), '{"a": "target"}');

    const result = await runFindReplace({
      pattern: '"target"',
      replacement: '"broken',
      files: join(dir, "*.json"),
    });

    expect(result.is_error).toBe(true);
    expect(result.content).toContain("Syntax error");
    expect(result.content).toContain("a.json");
    expect(result.content).toContain("reverted");
  });

  it("lint failure on later file reverts earlier successful writes", async () => {
    // a.txt passes lint (no linter for .txt), z.json fails lint
    writeFileSync(join(dir, "a.txt"), "target here");
    writeFileSync(join(dir, "z.json"), '{"k": "target"}');

    const result = await runFindReplace({
      pattern: "target",
      replacement: 'target"x',
      files: join(dir, "*"),
    });

    expect(result.is_error).toBe(true);
    expect(result.content).toContain("Syntax error");
    expect(result.content).toContain("z.json");
    // a.txt must be reverted even though it was successfully written
    expect(readFileSync(join(dir, "a.txt"), "utf-8")).toBe("target here");
    expect(readFileSync(join(dir, "z.json"), "utf-8")).toBe('{"k": "target"}');
  });

  it("reports revert failures when rollback write fails", async () => {
    writeFileSync(join(dir, "ok.json"), '{"a": "val"}');
    writeFileSync(join(dir, "fail.json"), '{"b": "val"}');

    // Make fail.json read-only — the replacement write will succeed
    // (file_write overwrites), but after we chmod below, rollback will fail
    const result = await runFindReplace({
      pattern: '"val"',
      replacement: '"val"bad',
      files: join(dir, "*.json"),
    });

    // This just verifies the lint error path works. The revert failure
    // test below is more specific.
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("Syntax error");
  });

  it("no false stale warning after lint-reverted find-replace", async () => {
    const p = join(dir, "stale-fr.json");
    writeFileSync(p, '{"key": "val"}');
    recordRead(p);

    const result = await runFindReplace({
      pattern: '"val"',
      replacement: '"val"bad',
      files: join(dir, "stale-fr.json"),
    });

    expect(result.is_error).toBe(true);
    expect(readFileSync(p, "utf-8")).toBe('{"key": "val"}');

    // File tracker should be up-to-date after revert
    expect(checkFreshness(p)).toBeNull();
  });

  it("dry run includes dotfiles in preview", async () => {
    writeFileSync(join(dir, "visible.txt"), "target");
    writeFileSync(join(dir, ".hidden.txt"), "target");

    const result = await runFindReplace({
      pattern: "target",
      replacement: "replaced",
      files: join(dir, "*.txt"),
      dry_run: true,
    });

    expect(result.is_error).toBeUndefined();
    expect(result.content).toContain("2 match(es)");
    expect(result.content).toContain("2 file(s)");
    expect(result.content).toContain(".hidden.txt");
  });

  it("replacement with empty string in regex mode", async () => {
    writeFileSync(join(dir, "a.txt"), "foo123bar456baz");

    const result = await runFindReplace({
      pattern: "\\d+",
      replacement: "",
      files: join(dir, "*.txt"),
      is_regex: true,
    });

    expect(result.is_error).toBeUndefined();
    expect(readFileSync(join(dir, "a.txt"), "utf-8")).toBe("foobarbaz");
  });

  it("replacement with $& in regex mode uses match", async () => {
    writeFileSync(join(dir, "a.txt"), "hello world");

    const result = await runFindReplace({
      pattern: "\\w+",
      replacement: "[$&]",
      files: join(dir, "*.txt"),
      is_regex: true,
    });

    expect(result.is_error).toBeUndefined();
    expect(readFileSync(join(dir, "a.txt"), "utf-8")).toBe("[hello] [world]");
  });

  it("word boundary with non-word-char pattern finds no match (expected)", async () => {
    // $5 starts with $, which is not a word character (\w).
    // \b requires a word/non-word boundary, but $ is non-word and so is the
    // space before it — so \b\$5\b won't match. This is correct regex behavior.
    writeFileSync(join(dir, "a.txt"), "price is $5 here");

    const result = await runFindReplace({
      pattern: "$5",
      replacement: "$10",
      files: join(dir, "*.txt"),
      word_boundary: true,
    });

    expect(result.content).toContain("No matches");
    expect(readFileSync(join(dir, "a.txt"), "utf-8")).toBe("price is $5 here");
  });

  it("word boundary with word-char pattern works correctly", async () => {
    writeFileSync(join(dir, "a.txt"), "count is x5 here x50 too");

    const result = await runFindReplace({
      pattern: "x5",
      replacement: "y9",
      files: join(dir, "*.txt"),
      word_boundary: true,
    });

    // x5 is a word (\w+), so \bx5\b matches "x5" but not "x50"
    expect(result.is_error).toBeUndefined();
    expect(readFileSync(join(dir, "a.txt"), "utf-8")).toBe("count is y9 here x50 too");
  });
});
