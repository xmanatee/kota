import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { checkFreshness, recordRead } from "#core/file-tracking/file-tracker.js";
import { runFindReplace } from "./find-replace.js";

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "find-replace-")); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });
function file(name: string, content: string): string {
  const path = join(root, name);
  writeFileSync(path, content);
  return path;
}

it.each([
  ["literal dollars", "foo bar foo", "foo", "$& $$", false, false, "$& $$ bar $& $$", 2],
  ["word boundary", "foo foobar barfoo foo", "foo", "$5", false, true, "$5 foobar barfoo $5", 2],
  ["capture groups", "getName() getAge()", "get(\\w+)", "fetch$1", true, false, "fetchName() fetchAge()", 2],
  ["match substitution", "hello world", "\\w+", "[$&]", true, false, "[hello] [world]", 2],
  ["lookahead", "abc", "(?=b)", "|", true, false, "a|bc", 1],
  ["regex deletion", "foo123bar456", "\\d+", "", true, false, "foobar", 2],
  ["literal deletion", "hello world", " world", "", false, false, "hello", 1],
  ["no match", "hello world", "absent", "x", false, false, "hello world", 0],
  ["nonword boundary", "price is $5 here", "$5", "$10", false, true, "price is $5 here", 0],
])("persists %s through the tool", async (_name, content, pattern, replacement, is_regex, word_boundary, expected, count) => {
  const path = file("input.txt", content);
  const result = await runFindReplace({ pattern, replacement, is_regex, word_boundary, files: "*.txt" }, { cwd: root });
  expect(result.is_error).toBeUndefined();
  expect(readFileSync(path, "utf8")).toBe(expected);
  expect(result.content).toContain(count === 0 ? "No matches" : `Replaced ${count} occurrence(s)`);
});

it.each([false, true])("selects nested and hidden files while preserving nonmatches, empty and binary files; dry_run=%s", async (dry_run) => {
  mkdirSync(join(root, ".config"));
  const originals = new Map([
    [file("visible.txt", "target target"), "target target"],
    [file(".hidden.txt", "target"), "target"],
    [file(".config/nested.txt", "target"), "target"],
    [file("nonmatch.txt", "unchanged"), "unchanged"],
    [file("empty.txt", ""), ""],
    [file("binary.txt", "target\0"), "target\0"],
  ]);
  const result = await runFindReplace({ pattern: "target", replacement: "new", files: "**/*.txt", dry_run }, { cwd: root });
  expect(result.is_error).toBeUndefined();
  expect(result.content).toContain("3 file(s)");
  expect(result.content).toContain(dry_run ? "4 match(es)" : "4 occurrence(s)");
  expect(result.content).toContain(".hidden.txt");
  for (const [path, content] of originals) {
    expect(readFileSync(path, "utf8")).toBe(dry_run || content.includes("\0") ? content : content.replaceAll("target", "new"));
  }
});

it.each([
  ["pattern", { pattern: "", replacement: "new" }, "pattern is required"],
  ["replacement", { pattern: "old" }, "replacement is required"],
  ["files", { pattern: "old", replacement: "new", files: "" }, "files glob pattern is required"],
  ["regex", { pattern: "[invalid", replacement: "new", is_regex: true }, "invalid regex"],
  ["unmatched glob", { pattern: "old", replacement: "new", files: "*.absent" }, "No files match"],
])("rejects invalid %s without modifying input", async (_name, input, error) => {
  const path = file("input.txt", "old");
  expect(await runFindReplace({ files: "*.txt", ...input }, { cwd: root })).toMatchObject({ is_error: true, content: expect.stringContaining(error) });
  expect(readFileSync(path, "utf8")).toBe("old");
});

it("preserves requested unfinished syntax and refreshes reads across selected files", async () => {
  const originals = new Map([
    [file("one.txt", "target here"), "target here"],
    [file("two.json", '{"key":"target"}'), '{"key":"target"}'],
  ]);
  for (const path of originals.keys()) recordRead(path);
  const result = await runFindReplace({ pattern: "target", replacement: 'target"bad', files: "*" }, { cwd: root });
  expect(result.is_error).toBeUndefined();
  expect(result.content).toContain("two.json");
  for (const [path, original] of originals) {
    expect(readFileSync(path, "utf8")).toBe(original.replace("target", 'target"bad'));
    expect(checkFreshness(path)).toBeNull();
  }
  const retry = await runFindReplace({ pattern: 'target"bad', replacement: "valid", files: "*" }, { cwd: root });
  expect(retry.is_error).toBeUndefined();
  for (const [path, original] of originals) expect(readFileSync(path, "utf8")).toBe(original.replace("target", "valid"));
});
