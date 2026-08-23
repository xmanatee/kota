import { execSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkSourceFileSize, SOURCE_FILE_SIZE_WARNING_TYPE } from "./source-size-check.js";
import {
  checkSevereSourceFileSize,
  evaluateSourceFileSize,
  SOURCE_FILE_SEVERE_BATCH_THRESHOLD,
} from "./source-size-escalation.js";

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

function writeSourceSizeCleanupTask(
  dir: string,
  file: string,
  state: "doing" | "blocked" = "doing",
): void {
  mkdirSync(join(dir, "data", "tasks", state), { recursive: true });
  writeFileSync(
    join(dir, "data", "tasks", state, "task-source-size-cleanup.md"),
    [
      "---",
      "id: task-source-size-cleanup",
      "title: Split oversized source-size fixture",
      `status: ${state}`,
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

function writeEvalHarnessCleanupTask(dir: string): void {
  mkdirSync(join(dir, "data", "tasks", "ready"), { recursive: true });
  writeFileSync(
    join(
      dir,
      "data",
      "tasks",
      "ready",
      "task-split-oversized-eval-harness-fixture-and-runner-fi.md",
    ),
    [
      "---",
      "id: task-split-oversized-eval-harness-fixture-and-runner-fi",
      "title: Split oversized eval-harness fixture and runner files",
      "status: ready",
      "priority: p3",
      "area: modules",
      "summary: Warnings for src/modules/eval-harness/eval-set.test.ts, fixture-run.ts, fixture.test.ts, fixture.ts, runner.test.ts, runner.ts, and scoring.ts.",
      "updated_at: 2026-01-01T00:00:00.000Z",
      "---",
      "",
      "## Problem",
      "",
      "Split the oversized eval-harness fixture and runner files without changing behavior.",
      "",
    ].join("\n"),
  );
}

describe("evaluateSourceFileSize", () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = join(tmpdir(), `kota-source-size-review-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    mkdirSync(repoDir, { recursive: true });
    initRepo(repoDir);
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it("keeps a tiny legacy oversized-file edit advisory with the existing warning shape", () => {
    mkdirSync(join(repoDir, "src"), { recursive: true });
    writeFileSync(join(repoDir, "src/legacy-large.ts"), lines(301));
    execSync("git add src/legacy-large.ts", { cwd: repoDir });
    execSync('git commit -q -m "add legacy large file"', { cwd: repoDir });
    writeFileSync(join(repoDir, "src/legacy-large.ts"), `${lines(301)}export const touch = true;\n`);
    execSync("git add src/legacy-large.ts", { cwd: repoDir });

    const review = evaluateSourceFileSize(repoDir);

    expect(review.outcome).toBe("advisory");
    expect(review.warnings).toEqual([
      expect.objectContaining({
        type: SOURCE_FILE_SIZE_WARNING_TYPE,
        file: "src/legacy-large.ts",
        changedLines: 1,
      }),
    ]);
    expect(() => checkSourceFileSize(repoDir)).toThrow(SOURCE_FILE_SIZE_WARNING_TYPE);
    expect(checkSevereSourceFileSize(repoDir)).toContain("Advisory source-size warning");
  });

  it("blocks a tiny oversized-file touch when an open cleanup task names a sibling by basename", () => {
    mkdirSync(join(repoDir, "src", "modules", "eval-harness"), { recursive: true });
    writeFileSync(join(repoDir, "src", "modules", "eval-harness", "runner.ts"), lines(301));
    execSync("git add src/modules/eval-harness/runner.ts", { cwd: repoDir });
    execSync('git commit -q -m "add oversized eval runner"', { cwd: repoDir });
    writeFileSync(
      join(repoDir, "src", "modules", "eval-harness", "runner.ts"),
      `${lines(301)}export const touch = true;\n`,
    );
    writeEvalHarnessCleanupTask(repoDir);
    execSync(
      "git add src/modules/eval-harness/runner.ts data/tasks/ready/task-split-oversized-eval-harness-fixture-and-runner-fi.md",
      { cwd: repoDir },
    );

    const review = evaluateSourceFileSize(repoDir);

    expect(review.outcome).toBe("blocking");
    if (review.outcome !== "blocking") throw new Error("expected blocking review");
    expect(review.reasons).toEqual([
      expect.objectContaining({
        kind: "open-cleanup-overlap",
        files: ["src/modules/eval-harness/runner.ts"],
        taskIds: ["task-split-oversized-eval-harness-fixture-and-runner-fi"],
      }),
    ]);
    expect(() => checkSevereSourceFileSize(repoDir)).toThrow(/open-cleanup-overlap/);
  });

  it("blocks a multi-file oversized batch at the deterministic threshold", () => {
    mkdirSync(join(repoDir, "src"), { recursive: true });
    for (let i = 0; i < SOURCE_FILE_SEVERE_BATCH_THRESHOLD; i += 1) {
      writeFileSync(join(repoDir, "src", `large-${i}.ts`), lines(301));
    }
    execSync("git add src", { cwd: repoDir });

    const review = evaluateSourceFileSize(repoDir);

    expect(review.outcome).toBe("blocking");
    if (review.outcome !== "blocking") throw new Error("expected blocking review");
    expect(review.reasons).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "oversized-batch",
        warningCount: SOURCE_FILE_SEVERE_BATCH_THRESHOLD,
      }),
    ]));
    expect(() => checkSevereSourceFileSize(repoDir)).toThrow(/oversized-batch/);
  });

  it("blocks an oversized file with substantial positive growth", () => {
    mkdirSync(join(repoDir, "src"), { recursive: true });
    writeFileSync(join(repoDir, "src/growing.ts"), lines(200));
    execSync("git add src/growing.ts", { cwd: repoDir });
    execSync('git commit -q -m "add growing file"', { cwd: repoDir });
    writeFileSync(join(repoDir, "src/growing.ts"), lines(360));
    execSync("git add src/growing.ts", { cwd: repoDir });

    const review = evaluateSourceFileSize(repoDir);

    expect(review.outcome).toBe("blocking");
    if (review.outcome !== "blocking") throw new Error("expected blocking review");
    expect(review.reasons).toEqual([
      expect.objectContaining({
        kind: "substantial-growth",
        files: ["src/growing.ts"],
      }),
    ]);
  });

  it("passes a typed source-size cleanup exception when named warnings are reduced", () => {
    mkdirSync(join(repoDir, "src"), { recursive: true });
    writeFileSync(join(repoDir, "src/cleanup-target.ts"), lines(360));
    execSync("git add src/cleanup-target.ts", { cwd: repoDir });
    execSync('git commit -q -m "add oversized cleanup target"', { cwd: repoDir });
    writeFileSync(join(repoDir, "src/cleanup-target.ts"), lines(330));
    writeSourceSizeCleanupTask(repoDir, "src/cleanup-target.ts");
    execSync("git add src/cleanup-target.ts data/tasks/doing/task-source-size-cleanup.md", {
      cwd: repoDir,
    });

    const review = evaluateSourceFileSize(repoDir);

    expect(review.outcome).toBe("exception");
    if (review.outcome !== "exception") throw new Error("expected exception review");
    expect(review.reasons).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "open-cleanup-overlap",
        files: ["src/cleanup-target.ts"],
      }),
    ]));
    expect(review.exception).toMatchObject({
      kind: "source-size-cleanup",
      files: ["src/cleanup-target.ts"],
      reducingFiles: ["src/cleanup-target.ts"],
    });
    expect(checkSevereSourceFileSize(repoDir)).toContain("typed source-size cleanup exception");
  });

  it("passes a staged blocked-task exception when cleanup landed before an external blocker", () => {
    mkdirSync(join(repoDir, "src"), { recursive: true });
    writeFileSync(join(repoDir, "src/cleanup-target.ts"), lines(360));
    execSync("git add src/cleanup-target.ts", { cwd: repoDir });
    execSync('git commit -q -m "add oversized cleanup target"', { cwd: repoDir });
    writeFileSync(join(repoDir, "src/cleanup-target.ts"), lines(330));
    writeSourceSizeCleanupTask(repoDir, "src/cleanup-target.ts", "blocked");
    execSync(
      "git add src/cleanup-target.ts data/tasks/blocked/task-source-size-cleanup.md",
      { cwd: repoDir },
    );

    const review = evaluateSourceFileSize(repoDir);

    expect(review.outcome).toBe("exception");
    if (review.outcome !== "exception") throw new Error("expected exception review");
    expect(review.exception).toMatchObject({
      taskPath: "data/tasks/blocked/task-source-size-cleanup.md",
      reducingFiles: ["src/cleanup-target.ts"],
    });
  });
});
