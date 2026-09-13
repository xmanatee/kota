import { mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { runGlob } from "./glob.js";

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "glob-")); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

it("filters and sorts scoped paths before applying the result limit", async () => {
  for (const [i, name] of ["old.ts", "src/nested.ts", "new.ts", "other.js", "node_modules/dependency.ts", "dist/output.ts"].entries()) {
    const path = join(root, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "source");
    const date = new Date(1700000000000 + i * 10000);
    utimesSync(path, date, date);
  }
  expect((await runGlob({ pattern: "**/*.ts" }, { cwd: root })).content).toBe("new.ts\nsrc/nested.ts\nold.ts");
  expect((await runGlob({ pattern: "**/*.ts", max_results: 2 }, { cwd: root })).content).toBe("new.ts\nsrc/nested.ts\n\n[Showing 2 of 3 matches]");
  expect((await runGlob({ pattern: "**/*.js" }, { cwd: root })).content).toBe("other.js");
});

it("rejects a missing pattern and reports no matches", async () => {
  expect(await runGlob({ pattern: "" }, { cwd: root })).toMatchObject({ is_error: true, content: expect.stringContaining("pattern is required") });
  expect(await runGlob({ pattern: "*.absent" }, { cwd: root })).toEqual({ content: "No files matched." });
});

it("does not enumerate protected credential aliases", async () => {
  mkdirSync(join(root, ".KOTA"));
  for (const name of ["daemon-control.json", "daemon-instance.lock", "secrets.json"]) writeFileSync(join(root, ".KOTA", name), "synthetic-secret");
  expect(await runGlob({ path: ".KOTA", pattern: "**/*" }, { cwd: root })).toEqual({ content: "No files matched." });
});

it("keeps patterns and resolved matches inside the selected base", async () => {
  mkdirSync(join(root, "workspace"));
  mkdirSync(join(root, "private"));
  writeFileSync(join(root, "private", "secret.ts"), "private");
  symlinkSync(join(root, "private", "secret.ts"), join(root, "workspace", "alias.ts"));

  expect(await runGlob(
    { path: "workspace", pattern: "../private/*.ts" },
    { cwd: root },
  )).toMatchObject({
    is_error: true,
    content: expect.stringContaining("pattern must stay within path"),
  });
  expect(await runGlob(
    { path: "workspace", pattern: "\\.\\./private/*.ts" },
    { cwd: root },
  )).toMatchObject({ is_error: true });
  expect(await runGlob(
    { path: "workspace", pattern: "*.ts" },
    { cwd: root },
  )).toEqual({ content: "No files matched." });
});
