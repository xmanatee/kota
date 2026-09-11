import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { checkFreshness, recordRead } from "#core/file-tracking/file-tracker.js";
import { runFileWrite } from "./file-write.js";

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "file-write-")); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

it.each([
  [{ content: "hello" }, "path is required"],
  [{ path: "", content: "hello" }, "path is required"],
  [{ path: "input.txt" }, "content is required"],
  [{ path: "input.txt", content: null }, "content is required"],
])("rejects invalid write %j", async (input, error) => {
  expect(await runFileWrite(input, { cwd: root })).toMatchObject({ is_error: true, content: expect.stringContaining(error) });
  expect(existsSync(join(root, "input.txt"))).toBe(false);
});

it.each(["", "one\ntwo\nthree"])("creates nested files relative to the selected scope: %s", async (content) => {
  const result = await runFileWrite({ path: "nested/file.txt", content }, { cwd: root });
  expect(result.is_error).toBeUndefined();
  expect(result.content).toContain(`${content.split("\n").length} lines`);
  expect(readFileSync(join(root, "nested/file.txt"), "utf8")).toBe(content);
});

it.each([false, true])("preserves unfinished JSON then accepts corrected contents; existed=%s", async (existed) => {
  const path = join(root, "input.json");
  if (existed) { writeFileSync(path, '{"old":true}'); recordRead(path); }
  expect((await runFileWrite({ path, content: "{broken,,}" })).is_error).toBeUndefined();
  expect(readFileSync(path, "utf8")).toBe("{broken,,}");
  if (existed) {
    expect(checkFreshness(path)).toBeNull();
  }
  expect((await runFileWrite({ path, content: '{"new":true}' })).is_error).toBeUndefined();
  expect(readFileSync(path, "utf8")).toBe('{"new":true}');
});
