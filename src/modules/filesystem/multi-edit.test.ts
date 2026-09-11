import { linkSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { checkFreshness, recordRead } from "#core/file-tracking/file-tracker.js";
import { initChangeTracker, resetChangeTracker } from "#core/loop/file-changes.js";
import { runMultiEdit } from "./multi-edit.js";

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "multi-edit-")); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

it.each([undefined, [], "not-array"])("rejects invalid edits %s", async (edits) => {
  expect(await runMultiEdit({ edits })).toMatchObject({ is_error: true, content: expect.stringContaining("edits array is required") });
});

it.each([
  ["missing path", { old_string: "old", new_string: "new" }, "missing required fields"],
  ["missing search", { path: "input.txt", new_string: "new" }, "missing required fields"],
  ["missing replacement", { path: "input.txt", old_string: "old" }, "missing required fields"],
  ["identical", { path: "input.txt", old_string: "old", new_string: "old" }, "identical"],
  ["missing file", { path: "missing.txt", old_string: "old", new_string: "new" }, "file not found"],
])("rejects a later %s edit while preserving all input", async (_name, invalid, error) => {
  const path = join(root, "input.txt");
  writeFileSync(path, "old");
  const result = await runMultiEdit({ edits: [{ path: "input.txt", old_string: "old", new_string: "first" }, invalid] }, { cwd: root });
  expect(result).toMatchObject({ is_error: true, content: expect.stringContaining(error) });
  expect(readFileSync(path, "utf8")).toBe("old");
});

it.each([false, true])("applies dependent edits and deletion across files with literal replacement; replace_all=%s", async (replace_all) => {
  const a = join(root, "a.txt");
  const b = join(root, "b.txt");
  writeFileSync(a, "hello world");
  writeFileSync(b, replace_all ? "cat cat" : "cat");
  const result = await runMultiEdit({ edits: [
    { path: a, old_string: "hello", new_string: "hi" },
    { path: a, old_string: "hi world", new_string: "hi earth" },
    { path: a, old_string: "hi ", new_string: "" },
    { path: b, old_string: "cat", new_string: "$&", replace_all },
  ] });
  expect(result.is_error).toBeUndefined();
  expect(result.content).toContain("4 edit(s)");
  expect(result.content).toContain("2 file(s)");
  expect(readFileSync(a, "utf8")).toBe("earth");
  expect(readFileSync(b, "utf8")).toBe(replace_all ? "$& $&" : "$&");
});

it.each([
  ["missing search", "b.txt", "beta", "missing", "x", "not found"],
  ["ambiguous search", "b.txt", "dup dup", "dup", "x", "2 times"],
])("leaves files untouched after later %s preparation failure", async (_name, name, original, old_string, new_string, error) => {
  const a = join(root, "a.txt");
  const b = join(root, name);
  writeFileSync(a, "alpha");
  writeFileSync(b, original);
  utimesSync(a, 1, 1);
  recordRead(a);
  recordRead(b);
  const result = await runMultiEdit({ edits: [
    { path: a, old_string: "alpha", new_string: "changed" },
    { path: b, old_string, new_string },
  ] });
  expect(result).toMatchObject({ is_error: true, content: expect.stringContaining(error) });
  expect(readFileSync(a, "utf8")).toBe("alpha");
  expect(readFileSync(b, "utf8")).toBe(original);
  expect(checkFreshness(a)).toBeNull();
  expect(statSync(a).mtimeMs).toBe(1000);
  expect(checkFreshness(b)).toBeNull();
});

it("restores the original file after a dependent edit fails", async () => {
  const path = join(root, "input.txt");
  writeFileSync(path, "alpha");
  const result = await runMultiEdit({ edits: [
    { path, old_string: "alpha", new_string: "beta" },
    { path, old_string: "alpha", new_string: "gamma" },
  ] });
  expect(result.is_error).toBe(true);
  expect(readFileSync(path, "utf8")).toBe("alpha");
});

function writeTemp(name: string, content: string): string {
  const path = join(root, name); writeFileSync(path, content); return path;
}
function readTemp(name: string): string { return readFileSync(join(root, name), "utf8"); }
  it.each([
    { kind: "symlink", link: symlinkSync },
    { kind: "hardlink", link: linkSync },
  ])("applies dependent edits to the same file through a $kind alias", async ({ kind, link }) => {
    const filename = `multi-same-${kind}.txt`;
    const path = writeTemp(filename, "aaa bbb ccc");
    const alias = join(root, `alias-${kind}.txt`);
    link(path, alias);
    const result = await runMultiEdit(
      {
        edits: [
          { path: filename, old_string: "aaa", new_string: "xxx" },
          { path: alias, old_string: "xxx bbb", new_string: "xxx yyy" },
        ],
      },
      { cwd: root },
    );
    expect(result.is_error).toBeUndefined();
    expect(result.content).toContain("2 edit(s)");
    expect(result.content).toContain("1 file(s)");
    expect(readFileSync(path, "utf-8")).toBe("xxx yyy ccc");
    expect(readFileSync(alias, "utf-8")).toBe("xxx yyy ccc");
  });
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
