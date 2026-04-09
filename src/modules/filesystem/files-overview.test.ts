import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runFilesOverview } from "./files-overview.js";

describe("files_overview", () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "fov-"));
    await writeFile(join(dir, "readme.md"), "# My Project\nSome content");
    await writeFile(join(dir, "data.csv"), "name,age,city\nAlice,30,NYC\nBob,25,LA");
    await writeFile(join(dir, "config.json"), '{"host":"localhost","port":3000}');
    await mkdir(join(dir, "docs"));
    await writeFile(join(dir, "docs", "guide.txt"), "Getting started with the project");
    await writeFile(join(dir, "photo.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("categorizes files and shows summary line", async () => {
    const r = await runFilesOverview({ path: dir });
    expect(r.is_error).toBeUndefined();
    expect(r.content).toContain("Documents");
    expect(r.content).toContain("readme.md");
    expect(r.content).toContain("Data");
    expect(r.content).toContain("data.csv");
    expect(r.content).toContain("Images");
    expect(r.content).toContain("photo.png");
    expect(r.content).toMatch(/\d+ files.*\d+ subdirs/);
  });

  it("shows markdown heading preview", async () => {
    const r = await runFilesOverview({ path: dir });
    expect(r.content).toContain("# My Project");
  });

  it("shows CSV column and row preview", async () => {
    const r = await runFilesOverview({ path: dir });
    expect(r.content).toMatch(/2 rows, columns: name, age, city/);
  });

  it("shows JSON key preview", async () => {
    const r = await runFilesOverview({ path: dir });
    expect(r.content).toContain("keys: host, port");
  });

  it("recurses into subdirectories by default", async () => {
    const r = await runFilesOverview({ path: dir });
    expect(r.content).toContain("Subdirectories: docs");
    expect(r.content).toContain("guide.txt");
  });

  it("respects max_depth 0 — no recursion", async () => {
    const r = await runFilesOverview({ path: dir, max_depth: 0 });
    expect(r.content).toContain("docs");
    expect(r.content).not.toContain("guide.txt");
  });

  it("returns error for non-existent directory", async () => {
    const r = await runFilesOverview({ path: "/no/such/dir" });
    expect(r.is_error).toBe(true);
    expect(r.content).toContain("not found");
  });

  it("handles empty directory", async () => {
    const empty = join(dir, "empty-test");
    await mkdir(empty, { recursive: true });
    const r = await runFilesOverview({ path: empty });
    expect(r.content).toContain("empty");
  });

  it("returns error when path is a file, not a directory", async () => {
    const r = await runFilesOverview({ path: join(dir, "readme.md") });
    expect(r.is_error).toBe(true);
    expect(r.content).toContain("not a directory");
  });

  it("categorizes files without module as Other", async () => {
    await writeFile(join(dir, "Makefile"), "all:\n\techo hi");
    const r = await runFilesOverview({ path: dir });
    expect(r.content).toContain("Other");
    expect(r.content).toContain("Makefile");
  });

  it("skips node_modules and .git directories", async () => {
    await mkdir(join(dir, "node_modules"), { recursive: true });
    await writeFile(join(dir, "node_modules", "pkg.js"), "module.exports = {}");
    await mkdir(join(dir, ".git"), { recursive: true });
    await writeFile(join(dir, ".git", "HEAD"), "ref: refs/heads/main");
    const r = await runFilesOverview({ path: dir });
    expect(r.content).not.toContain("pkg.js");
    expect(r.content).not.toContain("HEAD");
  });

  it("truncates categories with more than 20 files", async () => {
    const manyDir = join(dir, "many-test");
    await mkdir(manyDir, { recursive: true });
    for (let i = 0; i < 25; i++) {
      await writeFile(join(manyDir, `file${i}.txt`), `content ${i}`);
    }
    const r = await runFilesOverview({ path: manyDir });
    expect(r.content).toContain("... and 5 more");
  });

  it("defaults to cwd when no path given", async () => {
    // Just verify it doesn't crash — result depends on actual cwd
    const r = await runFilesOverview({});
    expect(r.is_error).toBeUndefined();
  });

  it("shows YAML top-level keys preview", async () => {
    await writeFile(join(dir, "config.yaml"), "name: myapp\nversion: 1.0\nport: 8080");
    const r = await runFilesOverview({ path: dir });
    expect(r.content).toContain("keys: name, version, port");
  });
});
