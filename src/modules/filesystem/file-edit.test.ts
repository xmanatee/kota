import { mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { checkFreshness, recordRead } from "#core/file-tracking/file-tracker.js";
import { runFileEdit } from "./file-edit.js";

let root: string;
let path: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "file-edit-")); path = join(root, "edit.txt"); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

it.each([
  ["literal replacement", "prefix old suffix", "old", "$& $$ $' $`", false, "prefix $& $$ $' $` suffix"],
  ["deletion at EOF", "keep remove", " remove", "", false, "keep"],
  ["replace all", "log(name)\nlog(name)", "log(name)", "log(`${name}`)", true, "log(`${name}`)\nlog(`${name}`)"],
  ["whitespace correction", "    const result = compute(input);", "\tconst result = compute(input);", "const result = '$&';", false, "const result = '$&';"],
  ["blank lines and trailing whitespace", "before\nfunction foo() {\n  return 1;\n}\nafter", "function foo() { \n\n\treturn 1;  \n\n}", "function bar() {}", false, "before\nfunction bar() {}\nafter"],
])("applies %s to exact file bytes", async (_name, original, old_string, new_string, replace_all, expected) => {
  writeFileSync(path, original);
  const result = await runFileEdit({ path: "edit.txt", old_string, new_string, replace_all }, { cwd: root });
  expect(result.is_error).toBeUndefined();
  expect(readFileSync(path, "utf8")).toBe(expected);
});

it.each([
  ["exact ambiguity", "foo bar foo", "foo", "appears 2 times"],
  ["whitespace ambiguity", "    return true;\nelse\n    return true;", "\treturn true;", "not found"],
  ["unsafe short fuzzy match", "    x = 1", "\tx = 1", "not found"],
  ["empty search", "content", "", "old_string is required"],
  ["blank search", "content", "  \n\n  ", "not found"],
  ["longer search", "const x = 1;", "const x = 1;\nconst y = 2;", "not found"],
  ["unrelated search", "line 1\nline 2", "zzzzzzzzzzzzzzzzzzzz", "no close match"],
])("rejects %s without changing the file", async (_name, original, old_string, error) => {
  writeFileSync(path, original);
  const result = await runFileEdit({ path, old_string, new_string: "replacement" });
  expect(result).toMatchObject({ is_error: true, content: expect.stringContaining(error) });
  expect(readFileSync(path, "utf8")).toBe(original);
});

it.each([
  ["missing path", { path: "", old_string: "a", new_string: "b" }, "path is required"],
  ["missing replacement", { old_string: "a" }, "new_string is required"],
  ["identical replacement", { old_string: "a", new_string: "a" }, "identical"],
])("validates %s", async (_name, input, message) => {
  writeFileSync(path, "a");
  expect(await runFileEdit({ path, ...input })).toMatchObject({ is_error: true, content: expect.stringContaining(message) });
  expect(readFileSync(path, "utf8")).toBe("a");
});

it("rejects nonexistent files and directories", async () => {
  for (const target of [path, root]) {
    expect(await runFileEdit({ path: target, old_string: "a", new_string: "b" })).toMatchObject({ is_error: true });
  }
});

it.each(["exact", "whitespace"])("preserves unfinished syntax through %s edits and permits a later correction", async (mode) => {
  path = join(root, "config.json");
  const original = '{\n    "setting": "old_value_here"\n}';
  writeFileSync(path, original);
  recordRead(path);
  const old_string = `${mode === "exact" ? "    " : "\t"}"setting": "old_value_here"`;
  const bad = await runFileEdit({ path, old_string, new_string: '    "setting": "bad",' });
  expect(bad.is_error).toBeUndefined();
  expect(readFileSync(path, "utf8")).toBe('{\n    "setting": "bad",\n}');
  expect(checkFreshness(path)).toBeNull();
  const good = await runFileEdit({ path, old_string: '    "setting": "bad",', new_string: '    "setting": "new_value_here"' });
  expect(good.is_error).toBeUndefined();
  expect(good.content).not.toContain("modified since");
  expect(readFileSync(path, "utf8")).toBe('{\n    "setting": "new_value_here"\n}');
  expect(checkFreshness(path)).toBeNull();
});

it("reports the best near-match without editing it", async () => {
  const original = ["  const result = computeSpecialValue(input);", ...Array.from({ length: 8 }, (_, i) => `filler ${i}`), "  // old: const result = computeSpecialValue(otherOutput); was here"].join("\n");
  writeFileSync(path, original);
  const result = await runFileEdit({ path, old_string: "const result = computeSpecialValue(output);", new_string: "replacement" });
  expect(result).toMatchObject({ is_error: true, content: expect.stringContaining("near line 1:") });
  expect(readFileSync(path, "utf8")).toBe(original);
});

it("warns when a failed edit used a stale read", async () => {
  writeFileSync(path, "original content");
  recordRead(path);
  const later = new Date(Date.now() + 10000);
  utimesSync(path, later, later);
  expect(await runFileEdit({ path, old_string: "unrelated search", new_string: "replacement" })).toMatchObject({ is_error: true, content: expect.stringContaining("modified since") });
  expect(readFileSync(path, "utf8")).toBe("original content");
});
