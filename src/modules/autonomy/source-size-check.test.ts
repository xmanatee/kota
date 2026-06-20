import { execSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  checkSourceFileSize,
  detectSourceFileSizeWarnings,
  extractSourceFileSizeWarningsFromBuildOutput,
  SOURCE_FILE_SIZE_EXCLUDED_PATH_PARTS,
  SOURCE_FILE_SIZE_WARNING_TYPE,
} from "./source-size-check.js";

function diffFor(file: string, added: number, deleted = 0): string {
  const deletedLines = Array.from({ length: deleted }, (_, i) => `-old${i}`).join("\n");
  const addedLines = Array.from({ length: added }, (_, i) => `+new${i}`).join("\n");
  return [
    `diff --git a/${file} b/${file}`,
    "index 0000001..0000002 100644",
    `--- a/${file}`,
    `+++ b/${file}`,
    `@@ -1,${deleted} +1,${added} @@`,
    deletedLines,
    addedLines,
  ]
    .filter(Boolean)
    .join("\n");
}

function lines(count: number): string {
  return `${Array.from({ length: count }, (_, i) => `export const value${i} = ${i};`).join("\n")}\n`;
}

function initRepo(dir: string): void {
  execSync("git init -q", { cwd: dir });
  execSync('git config user.email "test@test"', { cwd: dir });
  execSync('git config user.name "Test"', { cwd: dir });
  writeFileSync(join(dir, "README.md"), "init\n");
  execSync("git add README.md", { cwd: dir });
  execSync('git commit -q -m "init"', { cwd: dir });
}

describe("detectSourceFileSizeWarnings", () => {
  it("warns when a changed source file is over 300 lines", () => {
    const warnings = detectSourceFileSizeWarnings(diffFor("src/large.ts", 1), (file) =>
      file === "src/large.ts" ? 301 : null,
    );

    expect(warnings).toEqual([
      expect.objectContaining({
        type: SOURCE_FILE_SIZE_WARNING_TYPE,
        file: "src/large.ts",
        lines: 301,
        threshold: 300,
        changedLines: 1,
      }),
    ]);
  });

  it("warns when a touched file grows by more than 150 lines and ends over 300 lines", () => {
    const warnings = detectSourceFileSizeWarnings(diffFor("src/growing.ts", 175), (file) =>
      file === "src/growing.ts" ? 325 : null,
    );

    expect(warnings[0]).toMatchObject({
      type: SOURCE_FILE_SIZE_WARNING_TYPE,
      file: "src/growing.ts",
      lines: 325,
      changedLines: 175,
    });
    expect(warnings[0].message).toContain("150-line growth threshold");
  });

  it("does not warn for untouched oversized files", () => {
    const warnings = detectSourceFileSizeWarnings("", (file) =>
      file === "src/legacy-large.ts" ? 800 : null,
    );

    expect(warnings).toEqual([]);
  });

  it("skips generated, build, and vendored paths", () => {
    const files = [
      "dist/large.ts",
      "src/generated/large.ts",
      "src/__generated__/large.ts",
      "vendor/large.ts",
      "third_party/large.ts",
      "node_modules/package/large.ts",
    ];
    const diff = files.map((file) => diffFor(file, 200)).join("\n");

    expect(SOURCE_FILE_SIZE_EXCLUDED_PATH_PARTS).toEqual(
      expect.arrayContaining(["dist", "generated", "__generated__", "vendor", "third_party", "node_modules"]),
    );
    expect(detectSourceFileSizeWarnings(diff, () => 500)).toEqual([]);
  });

  it("extracts source-file-size warnings from builder repair-warning output", () => {
    const warning = detectSourceFileSizeWarnings(diffFor("src/large.ts", 1), () => 301)[0];

    expect(
      extractSourceFileSizeWarningsFromBuildOutput({
        repairWarnings: [
          { id: "repo-hygiene", output: "advisory" },
          { id: SOURCE_FILE_SIZE_WARNING_TYPE, output: JSON.stringify([warning]) },
        ],
      }),
    ).toEqual([warning]);
  });
});

describe("checkSourceFileSize", () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = join(tmpdir(), `kota-source-size-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    mkdirSync(repoDir, { recursive: true });
    initRepo(repoDir);
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it("passes when an untouched oversized source file exists", () => {
    mkdirSync(join(repoDir, "src"), { recursive: true });
    writeFileSync(join(repoDir, "src/legacy-large.ts"), lines(500));
    execSync("git add src/legacy-large.ts && git commit -q -m 'add legacy large file'", {
      cwd: repoDir,
      shell: "/bin/sh",
    });

    writeFileSync(join(repoDir, "src/small.ts"), "export const small = true;\n");
    execSync("git add src/small.ts", { cwd: repoDir });

    expect(checkSourceFileSize(repoDir)).toContain("OK");
  });

  it("throws a structured source-file-size warning for a staged oversized source file", () => {
    mkdirSync(join(repoDir, "src"), { recursive: true });
    writeFileSync(join(repoDir, "src/large.ts"), lines(301));
    execSync("git add src/large.ts", { cwd: repoDir });

    expect(() => checkSourceFileSize(repoDir)).toThrow(SOURCE_FILE_SIZE_WARNING_TYPE);
  });
});
