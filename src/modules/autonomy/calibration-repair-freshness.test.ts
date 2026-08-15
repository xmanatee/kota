import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
    const descendant = commitDescendant(projectDir);
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
