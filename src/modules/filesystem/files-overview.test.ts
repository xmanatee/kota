import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { runFilesOverview } from "./files-overview.js";

let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "overview-")); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

it("renders categories and representative previews in the selected scope", async () => {
  for (const [name, content] of [
    ["readme.md", "# My Project\ncontent"],
    ["data.csv", "name,age\nAlice,30\nBob,25"],
    ["config.json", '{"host":"localhost","port":3000}'],
    ["config.yaml", "name: app\nversion: 1\nport: 8080"],
    ["photo.png", "image"],
    ["Makefile", "all:\n echo hi"],
  ]) await writeFile(join(root, name), content);
  const result = await runFilesOverview({}, { cwd: root });
  expect(result.is_error).toBeUndefined();
  for (const text of ["Documents", "# My Project", "Data", "2 rows, columns: name, age", "keys: host, port", "keys: name, version, port", "Images", "photo.png", "Other", "Makefile"]) expect(result.content).toContain(text);
  expect(result.content).toContain("6 files");
});

it("resolves recursion depth and omits dependencies and protected credentials", async () => {
  for (const dir of ["docs", "node_modules", ".KOTA"]) await mkdir(join(root, dir));
  await writeFile(join(root, "docs", "guide.txt"), "guide");
  await writeFile(join(root, "node_modules", "dependency.js"), "not-for-preview");
  await writeFile(join(root, ".KOTA", "daemon-control.json"), '{"token":"synthetic-secret"}');
  await writeFile(join(root, ".env"), "TOKEN=synthetic-secret");
  const result = await runFilesOverview({}, { cwd: root });
  expect(result.content).toContain("guide.txt");
  for (const excluded of ["dependency.js", "daemon-control.json", ".env", "synthetic-secret"]) expect(result.content).not.toContain(excluded);
  const shallow = await runFilesOverview({ max_depth: 0 }, { cwd: root });
  expect(shallow.content).toContain("docs");
  expect(shallow.content).not.toContain("guide.txt");
});

it("distinguishes empty directories, missing paths and files", async () => {
  expect((await runFilesOverview({}, { cwd: root })).content).toContain("empty");
  expect(await runFilesOverview({ path: "absent" }, { cwd: root })).toMatchObject({ is_error: true, content: expect.stringContaining("not found") });
  await writeFile(join(root, "file.txt"), "content");
  expect(await runFilesOverview({ path: "file.txt" }, { cwd: root })).toMatchObject({ is_error: true, content: expect.stringContaining("not a directory") });
});

it("bounds a populated category and reports omitted files", async () => {
  await Promise.all(Array.from({ length: 25 }, (_, i) => writeFile(join(root, `file${i}.txt`), "content")));
  expect((await runFilesOverview({}, { cwd: root })).content).toContain("... and 5 more");
});
