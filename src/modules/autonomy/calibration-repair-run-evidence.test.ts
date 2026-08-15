import { renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CALIBRATION_REPAIR_TASK_ID } from "./calibration-repair.js";
import { inspectCalibrationRepairFreshness } from "./calibration-repair-freshness.js";
import {
  closeRepairTask,
  commitDescendant,
  makeProject,
  seedArtifact,
} from "./calibration-repair-freshness-test-support.js";

describe("calibration repair run-evidence trust", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = makeProject();
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("rejects the formerly accepted metadata-less artifact", () => {
    const repair = closeRepairTask(projectDir);
    const descendant = commitDescendant(projectDir);
    const seeded = seedArtifact(
      projectDir,
      "metadata-less-builder",
      descendant,
      "task-post-fix",
    );
    rmSync(seeded.metadataPath);

    expect(
      inspectCalibrationRepairFreshness(
        projectDir,
        repair.path,
        CALIBRATION_REPAIR_TASK_ID,
      ),
    ).toEqual({ status: "awaiting-descendant", repairRevision: repair.revision });
  });

  it("rejects mismatched run identities and non-builder metadata", () => {
    const repair = closeRepairTask(projectDir);
    const descendant = commitDescendant(projectDir);
    seedArtifact(projectDir, "metadata-id-mismatch", descendant, "task-a", {
      metadataId: "another-run",
    });
    seedArtifact(projectDir, "artifact-id-mismatch", descendant, "task-b", {
      artifactRunId: "another-run",
    });
    seedArtifact(projectDir, "non-builder", descendant, "task-c", {
      metadataWorkflow: "security-review",
      artifactWorkflow: "security-review",
    });

    expect(
      inspectCalibrationRepairFreshness(
        projectDir,
        repair.path,
        CALIBRATION_REPAIR_TASK_ID,
      ).status,
    ).toBe("awaiting-descendant");
  });

  it("rejects non-terminal runs and evidence without the canonical code step", () => {
    const repair = closeRepairTask(projectDir);
    const descendant = commitDescendant(projectDir);
    seedArtifact(projectDir, "running-builder", descendant, "task-a", {
      metadataStatus: "running",
    });
    seedArtifact(projectDir, "failed-builder", descendant, "task-b", {
      metadataStatus: "failed",
      artifactTerminalStatus: "failed",
    });
    seedArtifact(projectDir, "wrong-step", descendant, "task-c", {
      stepId: "agent-authored-calibration",
    });
    seedArtifact(projectDir, "failed-step", descendant, "task-d", {
      stepStatus: "failed",
    });
    const missingStepRecord = seedArtifact(
      projectDir,
      "missing-step-record",
      descendant,
      "task-e",
    );
    rmSync(missingStepRecord.stepPath);

    expect(
      inspectCalibrationRepairFreshness(
        projectDir,
        repair.path,
        CALIBRATION_REPAIR_TASK_ID,
      ).status,
    ).toBe("awaiting-descendant");
  });

  it("rejects malformed and symlinked artifact files", () => {
    const repair = closeRepairTask(projectDir);
    const descendant = commitDescendant(projectDir);
    const malformed = seedArtifact(
      projectDir,
      "malformed-builder",
      descendant,
      "task-malformed",
    );
    writeFileSync(malformed.artifactPath, "{not-json\n");

    const linkedArtifact = seedArtifact(
      projectDir,
      "linked-artifact-builder",
      descendant,
      "task-linked-artifact",
    );
    const artifactTarget = join(linkedArtifact.runDir, "artifact-target.json");
    renameSync(linkedArtifact.artifactPath, artifactTarget);
    symlinkSync(artifactTarget, linkedArtifact.artifactPath);

    expect(
      inspectCalibrationRepairFreshness(
        projectDir,
        repair.path,
        CALIBRATION_REPAIR_TASK_ID,
      ).status,
    ).toBe("awaiting-descendant");
  });

  it("rejects a symlinked run-directory entry", () => {
    const repair = closeRepairTask(projectDir);
    const descendant = commitDescendant(projectDir);
    const seeded = seedArtifact(
      projectDir,
      "linked-run-builder",
      descendant,
      "task-linked-run",
    );
    const target = join(projectDir, ".kota", "linked-run-target");
    renameSync(seeded.runDir, target);
    symlinkSync(target, seeded.runDir, "dir");

    expect(
      inspectCalibrationRepairFreshness(
        projectDir,
        repair.path,
        CALIBRATION_REPAIR_TASK_ID,
      ).status,
    ).toBe("awaiting-descendant");
  });
});
