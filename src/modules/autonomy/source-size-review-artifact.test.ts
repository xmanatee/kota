import { execSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SOURCE_FILE_SIZE_WARNING_TYPE } from "./source-size-check.js";
import { SOURCE_FILE_SEVERE_BATCH_THRESHOLD } from "./source-size-escalation.js";
import {
  checkSevereSourceFileSizeForRun,
  readSourceFileSizeReviewArtifact,
} from "./source-size-review-artifact.js";

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

function writeSourceSizeCleanupTask(dir: string, file: string): void {
  mkdirSync(join(dir, "data", "tasks", "doing"), { recursive: true });
  writeFileSync(
    join(dir, "data", "tasks", "doing", "task-source-size-cleanup.md"),
    [
      "---",
      "id: task-source-size-cleanup",
      "title: Split oversized source-size fixture",
      "status: doing",
      "priority: p2",
      "area: autonomy",
      "updated_at: 2026-01-01T00:00:00.000Z",
      "---",
      "",
      "## Source Size Exception",
      "",
      "kind: source-size-cleanup",
      "files:",
      `- ${file}`,
      "",
    ].join("\n"),
  );
}

describe("source-size review artifact", () => {
  let repoDir: string;
  let runDir: string;

  beforeEach(() => {
    repoDir = join(tmpdir(), `kota-source-size-artifact-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    runDir = join(repoDir, ".kota", "runs", "test-run");
    mkdirSync(join(repoDir, "src"), { recursive: true });
    mkdirSync(runDir, { recursive: true });
    initRepo(repoDir);
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it("records blocking severe reasons before throwing", () => {
    for (let i = 0; i < SOURCE_FILE_SEVERE_BATCH_THRESHOLD; i += 1) {
      writeFileSync(join(repoDir, "src", `large-${i}.ts`), lines(301));
    }
    execSync("git add src", { cwd: repoDir });

    expect(() => checkSevereSourceFileSizeForRun(repoDir, runDir)).toThrow(/oversized-batch/);

    expect(readSourceFileSizeReviewArtifact(runDir)).toMatchObject({
      outcome: "blocking",
      reasons: expect.arrayContaining([
        expect.objectContaining({
          kind: "oversized-batch",
          warningCount: SOURCE_FILE_SEVERE_BATCH_THRESHOLD,
        }),
      ]),
    });
  });

  it("records typed cleanup exceptions for successful repair-check output", () => {
    writeFileSync(join(repoDir, "src/cleanup-target.ts"), lines(360));
    execSync("git add src/cleanup-target.ts", { cwd: repoDir });
    execSync('git commit -q -m "add oversized cleanup target"', { cwd: repoDir });
    writeFileSync(join(repoDir, "src/cleanup-target.ts"), lines(330));
    writeSourceSizeCleanupTask(repoDir, "src/cleanup-target.ts");
    execSync("git add src/cleanup-target.ts data/tasks/doing/task-source-size-cleanup.md", {
      cwd: repoDir,
    });

    expect(checkSevereSourceFileSizeForRun(repoDir, runDir)).toContain(
      "typed source-size cleanup exception",
    );

    expect(readSourceFileSizeReviewArtifact(runDir)).toMatchObject({
      outcome: "exception",
      warnings: [
        expect.objectContaining({
          type: SOURCE_FILE_SIZE_WARNING_TYPE,
          file: "src/cleanup-target.ts",
        }),
      ],
      exception: {
        kind: "source-size-cleanup",
        files: ["src/cleanup-target.ts"],
        reducingFiles: ["src/cleanup-target.ts"],
      },
    });
  });
});
