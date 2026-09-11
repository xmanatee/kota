import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { detectEnvironment, detectWorkspaceTechnology, getDirectoryOverview } from "./workspace-detection.js";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "workspace-detection-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

it("detects package metadata and dependency roles, preferring the workspace over a build file", () => {
  writeFileSync(join(dir, "Makefile"), "all:");
  writeFileSync(join(dir, "package.json"), JSON.stringify({
    name: "my-app", dependencies: { react: "18", next: "14" },
    devDependencies: { typescript: "5", vitest: "1" },
    scripts: { build: "tsc", test: "vitest" },
  }));
  expect(detectWorkspaceTechnology(dir)).toBe(
    "Node.js workspace — my-app; frameworks: react, next; TypeScript; tests: vitest; scripts: build, test",
  );
});

it.each([
  ["package.json", "malformed{", "Node.js workspace"],
  ["Cargo.toml", '[package]\nname = "my-crate"', "Rust workspace — my-crate"],
  ["go.mod", "module github.com/user/repo\n\ngo 1.21", "Go workspace — github.com/user/repo"],
  ["pyproject.toml", '[project]\nname = "analyzer"', "Python workspace — analyzer"],
  ["requirements.txt", "flask\nrequests\n", "Python workspace"],
  ["Makefile", "all:", "Make-based workspace"],
])("interprets a %s workspace", (file, content, expected) => {
  writeFileSync(join(dir, file), content);
  expect(detectWorkspaceTechnology(dir)).toBe(expected);
});

it("returns no context for an empty or absent directory", () => {
  for (const root of [dir, join(dir, "absent")]) {
    expect(detectWorkspaceTechnology(root)).toBeNull();
    expect(detectEnvironment(root)).toBeNull();
    expect(getDirectoryOverview(root)).toBeNull();
  }
});

it("counts recognized regular files, ignoring hidden files, directories, and unknown extensions", () => {
  for (const file of ["sales.csv", "config.json", "report.md", "notes.txt", "paper.pdf", "photo.PNG", ".hidden.csv", "mystery.xyz"]) {
    writeFileSync(join(dir, file), "fixture");
  }
  mkdirSync(join(dir, "directory.csv"));
  expect(detectEnvironment(dir)).toBe("Workspace with 3 documents, 2 data files, 1 image");
});

it("omits categories when only hidden or unknown files exist", () => {
  writeFileSync(join(dir, ".hidden.csv"), "fixture");
  expect(detectEnvironment(dir)).toBeNull();
  expect(getDirectoryOverview(dir)).toBeNull();
  writeFileSync(join(dir, "mystery.xyz"), "fixture");
  expect(detectEnvironment(dir)).toBeNull();
});

it("lists visible content while omitting hidden and build directories", () => {
  for (const name of [".git", "node_modules", "src"]) mkdirSync(join(dir, name));
  for (const name of [".hidden", "readme.md", "data.csv"]) writeFileSync(join(dir, name), "fixture");
  expect(getDirectoryOverview(dir)).toBe("Dirs: src/\nFiles: data.csv, readme.md");
});

it.each(["files", "directories"] as const)("bounds the visible %s and reports the omitted count", (kind) => {
  const count = kind === "files" ? 20 : 13;
  for (let i = 0; i < count; i++) {
    const path = join(dir, `entry${String(i).padStart(2, "0")}`);
    if (kind === "files") writeFileSync(path, "fixture");
    else mkdirSync(path);
  }
  const output = getDirectoryOverview(dir);
  expect(output).toContain(kind === "files" ? "(+5 more)" : "(+3 more)");
  expect(output).toContain("entry00");
  expect(output).not.toContain(`entry${count - 1}`);
});
