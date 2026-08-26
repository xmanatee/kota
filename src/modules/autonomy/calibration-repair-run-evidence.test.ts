import { renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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
  makeProject,
  seedArtifact,
} from "./calibration-repair-freshness-test-support.js";

describe("calibration repair run-evidence trust", () => {
  let workspaceRoot: string;
  let runCommand: WorkflowCommandRunner;

  beforeEach(() => {
    workspaceRoot = makeProject();
    runCommand = createWorkflowCommandRunner({ cwd: workspaceRoot });
  });

  afterEach(() => {
    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("rejects the formerly accepted metadata-less artifact", async () => {
    const repair = closeRepairTask(workspaceRoot);
    const descendant = commitDescendant(workspaceRoot);
    const seeded = seedArtifact(
      workspaceRoot,
      "metadata-less-builder",
      descendant,
      "task-post-fix",
    );
    rmSync(seeded.metadataPath);

    expect(
      await inspectCalibrationRepairFreshness(
        workspaceRoot,
        repair.path,
        CALIBRATION_REPAIR_TASK_ID,
        runCommand,
      ),
    ).toEqual({ status: "awaiting-descendant", repairRevision: repair.revision });
  });

  it("rejects mismatched run identities and non-builder metadata", async () => {
    const repair = closeRepairTask(workspaceRoot);
    const descendant = commitDescendant(workspaceRoot);
    seedArtifact(workspaceRoot, "metadata-id-mismatch", descendant, "task-a", {
      metadataId: "another-run",
    });
    seedArtifact(workspaceRoot, "artifact-id-mismatch", descendant, "task-b", {
      artifactRunId: "another-run",
    });
    seedArtifact(workspaceRoot, "non-builder", descendant, "task-c", {
      metadataWorkflow: "security-review",
      artifactWorkflow: "security-review",
    });

    expect(
      (await inspectCalibrationRepairFreshness(
        workspaceRoot,
        repair.path,
        CALIBRATION_REPAIR_TASK_ID,
        runCommand,
      )).status,
    ).toBe("awaiting-descendant");
  });

  it("rejects non-terminal runs and evidence without the canonical code step", async () => {
    const repair = closeRepairTask(workspaceRoot);
    const descendant = commitDescendant(workspaceRoot);
    seedArtifact(workspaceRoot, "running-builder", descendant, "task-a", {
      metadataStatus: "running",
    });
    seedArtifact(workspaceRoot, "failed-builder", descendant, "task-b", {
      metadataStatus: "failed",
      artifactTerminalStatus: "failed",
    });
    seedArtifact(workspaceRoot, "wrong-step", descendant, "task-c", {
      stepId: "agent-authored-calibration",
    });
    seedArtifact(workspaceRoot, "failed-step", descendant, "task-d", {
      stepStatus: "failed",
    });
    const missingStepRecord = seedArtifact(
      workspaceRoot,
      "missing-step-record",
      descendant,
      "task-e",
    );
    rmSync(missingStepRecord.stepPath);

    expect(
      (await inspectCalibrationRepairFreshness(
        workspaceRoot,
        repair.path,
        CALIBRATION_REPAIR_TASK_ID,
        runCommand,
      )).status,
    ).toBe("awaiting-descendant");
  });

  it("rejects malformed and symlinked artifact files", async () => {
    const repair = closeRepairTask(workspaceRoot);
    const descendant = commitDescendant(workspaceRoot);
    const malformed = seedArtifact(
      workspaceRoot,
      "malformed-builder",
      descendant,
      "task-malformed",
    );
    writeFileSync(malformed.artifactPath, "{not-json\n");

    const linkedArtifact = seedArtifact(
      workspaceRoot,
      "linked-artifact-builder",
      descendant,
      "task-linked-artifact",
    );
    const artifactTarget = join(linkedArtifact.runDir, "artifact-target.json");
    renameSync(linkedArtifact.artifactPath, artifactTarget);
    symlinkSync(artifactTarget, linkedArtifact.artifactPath);

    expect(
      (await inspectCalibrationRepairFreshness(
        workspaceRoot,
        repair.path,
        CALIBRATION_REPAIR_TASK_ID,
        runCommand,
      )).status,
    ).toBe("awaiting-descendant");
  });

  it("rejects a symlinked run-directory entry", async () => {
    const repair = closeRepairTask(workspaceRoot);
    const descendant = commitDescendant(workspaceRoot);
    const seeded = seedArtifact(
      workspaceRoot,
      "linked-run-builder",
      descendant,
      "task-linked-run",
    );
    const target = join(workspaceRoot, ".kota", "linked-run-target");
    renameSync(seeded.runDir, target);
    symlinkSync(target, seeded.runDir, "dir");

    expect(
      (await inspectCalibrationRepairFreshness(
        workspaceRoot,
        repair.path,
        CALIBRATION_REPAIR_TASK_ID,
        runCommand,
      )).status,
    ).toBe("awaiting-descendant");
  });
});
