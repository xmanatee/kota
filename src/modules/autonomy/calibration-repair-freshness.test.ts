import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createWorkflowCommandRunner,
  type WorkflowCommandRunner,
} from "#core/workflow/workflow-command.js";
import { CALIBRATION_REPAIR_TASK_ID } from "./calibration-repair.js";
import { inspectCalibrationRepairFreshness } from "./calibration-repair-freshness.js";
import {
  closeRepairTask,
  commitDescendant,
  git,
  makeProject,
  seedArtifact,
} from "./calibration-repair-freshness-test-support.js";

describe("calibration repair freshness", () => {
  let projectDir: string;
  let runCommand: WorkflowCommandRunner;

  beforeEach(() => {
    projectDir = makeProject();
    runCommand = createWorkflowCommandRunner({ cwd: projectDir });
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("reports an untracked repair when no closing revision can be proven", async () => {
    const path = join(projectDir, "data", "tasks", "done", "untracked.md");
    writeFileSync(path, "---\nstatus: done\n---\n");

    expect(
      await inspectCalibrationRepairFreshness(
        projectDir,
        path,
        CALIBRATION_REPAIR_TASK_ID,
        runCommand,
      ),
    ).toEqual({ status: "untracked-repair" });
  });

  it("ignores the closing builder artifact written after its repair commit", async () => {
    const repair = closeRepairTask(projectDir);
    seedArtifact(
      projectDir,
      "closing-builder",
      repair.revision,
      CALIBRATION_REPAIR_TASK_ID,
    );

    expect(
      await inspectCalibrationRepairFreshness(
        projectDir,
        repair.path,
        CALIBRATION_REPAIR_TASK_ID,
        runCommand,
      ),
    ).toEqual({ status: "awaiting-descendant", repairRevision: repair.revision });
  });

  it("ignores concurrent evidence based on a revision before the repair", async () => {
    const preFixRevision = git(projectDir, ["rev-parse", "HEAD"]);
    const repair = closeRepairTask(projectDir);
    seedArtifact(projectDir, "concurrent-builder", preFixRevision, "task-concurrent");

    expect(
      (await inspectCalibrationRepairFreshness(
        projectDir,
        repair.path,
        CALIBRATION_REPAIR_TASK_ID,
        runCommand,
      )).status,
    ).toBe("awaiting-descendant");
  });

  it("accepts evidence whose source revision descends from the repair", async () => {
    const repair = closeRepairTask(projectDir);
    const descendant = commitDescendant(projectDir);
    seedArtifact(projectDir, "post-fix-builder", descendant, "task-post-fix");

    expect(
      await inspectCalibrationRepairFreshness(
        projectDir,
        repair.path,
        CALIBRATION_REPAIR_TASK_ID,
        runCommand,
      ),
    ).toEqual({
      status: "descendant-observed",
      repairRevision: repair.revision,
      runId: "post-fix-builder",
      sourceRevision: descendant,
    });
  });
});
