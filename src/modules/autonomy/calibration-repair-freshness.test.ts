import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CALIBRATION_REPAIR_TASK_ID } from "./calibration-repair.js";
import { inspectCalibrationRepairFreshness } from "./calibration-repair-freshness.js";
import { EVALUATOR_CALIBRATION_ARTIFACT } from "./evaluator-calibration.js";

function git(projectDir: string, args: string[]): string {
  return execFileSync("git", args, { cwd: projectDir, encoding: "utf8" }).trim();
}

function commitAll(projectDir: string, message: string): string {
  git(projectDir, ["add", "-A"]);
  git(projectDir, ["commit", "--allow-empty", "-m", message, "--quiet"]);
  return git(projectDir, ["rev-parse", "HEAD"]);
}

function makeProject(): string {
  const projectDir = mkdtempSync(join(tmpdir(), "cal-freshness-"));
  mkdirSync(join(projectDir, "data", "tasks", "done"), { recursive: true });
  mkdirSync(join(projectDir, ".kota", "runs"), { recursive: true });
  git(projectDir, ["init", "--quiet"]);
  git(projectDir, ["config", "user.email", "test@example.com"]);
  git(projectDir, ["config", "user.name", "test"]);
  git(projectDir, ["config", "commit.gpgsign", "false"]);
  commitAll(projectDir, "initial");
  return projectDir;
}

function closeRepairTask(projectDir: string): { path: string; revision: string } {
  const path = join(
    projectDir,
    "data",
    "tasks",
    "done",
    `${CALIBRATION_REPAIR_TASK_ID}.md`,
  );
  writeFileSync(path, `---\nid: ${CALIBRATION_REPAIR_TASK_ID}\nstatus: done\n---\n`);
  return { path, revision: commitAll(projectDir, "close repair") };
}

function seedArtifact(
  projectDir: string,
  runId: string,
  sourceRevision: string,
  taskId: string | null,
): void {
  const runDir = join(projectDir, ".kota", "runs", runId);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(
    join(runDir, EVALUATOR_CALIBRATION_ARTIFACT),
    JSON.stringify({
      runId,
      workflow: "builder",
      completedAt: "2099-01-01T00:00:00.000Z",
      verdict: "pass",
      warningCount: 0,
      criticalIssueCount: 0,
      repairIterations: 1,
      finalIterationFailures: [],
      criticFailureCount: 0,
      terminalRunStatus: "success",
      sourceRevision,
      taskId,
      taskFinalState: taskId === CALIBRATION_REPAIR_TASK_ID ? "done" : null,
      sourceFilesChanged: ["src/modules/autonomy/calibration-repair.ts"],
      criticPromptHash: "a9c80b96e38f",
    }),
  );
}

describe("calibration repair freshness", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = makeProject();
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("reports an untracked repair when no closing revision can be proven", () => {
    const path = join(projectDir, "data", "tasks", "done", "untracked.md");
    writeFileSync(path, "---\nstatus: done\n---\n");

    expect(
      inspectCalibrationRepairFreshness(
        projectDir,
        path,
        CALIBRATION_REPAIR_TASK_ID,
      ),
    ).toEqual({ status: "untracked-repair" });
  });

  it("ignores the closing builder artifact written after its repair commit", () => {
    const repair = closeRepairTask(projectDir);
    seedArtifact(
      projectDir,
      "closing-builder",
      repair.revision,
      CALIBRATION_REPAIR_TASK_ID,
    );

    expect(
      inspectCalibrationRepairFreshness(
        projectDir,
        repair.path,
        CALIBRATION_REPAIR_TASK_ID,
      ),
    ).toEqual({ status: "awaiting-descendant", repairRevision: repair.revision });
  });

  it("ignores concurrent evidence based on a revision before the repair", () => {
    const preFixRevision = git(projectDir, ["rev-parse", "HEAD"]);
    const repair = closeRepairTask(projectDir);
    seedArtifact(projectDir, "concurrent-builder", preFixRevision, "task-concurrent");

    expect(
      inspectCalibrationRepairFreshness(
        projectDir,
        repair.path,
        CALIBRATION_REPAIR_TASK_ID,
      ).status,
    ).toBe("awaiting-descendant");
  });

  it("accepts evidence whose source revision descends from the repair", () => {
    const repair = closeRepairTask(projectDir);
    writeFileSync(join(projectDir, "post-fix.ts"), "export const fixed = true;\n");
    const descendant = commitAll(projectDir, "post-fix builder");
    seedArtifact(projectDir, "post-fix-builder", descendant, "task-post-fix");

    expect(
      inspectCalibrationRepairFreshness(
        projectDir,
        repair.path,
        CALIBRATION_REPAIR_TASK_ID,
      ),
    ).toEqual({
      status: "descendant-observed",
      repairRevision: repair.revision,
      runId: "post-fix-builder",
      sourceRevision: descendant,
    });
  });
});
