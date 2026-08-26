import { lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  WorkflowCommandError,
  type WorkflowCommandRunner,
} from "#core/workflow/workflow-command.js";
import { readBoundCalibrationArtifact } from "./calibration-repair-run-evidence.js";

export type CalibrationRepairFreshness =
  | { status: "untracked-repair" }
  | { status: "awaiting-descendant"; repairRevision: string }
  | {
      status: "descendant-observed";
      repairRevision: string;
      runId: string;
      sourceRevision: string;
    };

const GIT_REVISION = /^[0-9a-f]{40}$/;

async function gitOutput(
  workspaceRoot: string,
  args: readonly string[],
  runCommand: WorkflowCommandRunner,
): Promise<string | null> {
  try {
    const result = await runCommand({
      command: "git",
      args,
      cwd: workspaceRoot,
    });
    const output = result.stdout.text.trim();
    return output.length > 0 ? output : null;
  } catch (error) {
    if (error instanceof WorkflowCommandError && error.kind === "failed") {
      return null;
    }
    throw error;
  }
}

async function isAncestor(
  workspaceRoot: string,
  ancestor: string,
  descendant: string,
  runCommand: WorkflowCommandRunner,
): Promise<boolean> {
  try {
    await runCommand({
      command: "git",
      args: ["merge-base", "--is-ancestor", ancestor, descendant],
      cwd: workspaceRoot,
    });
    return true;
  } catch (error) {
    if (error instanceof WorkflowCommandError && error.kind === "failed") {
      // A retained artifact can outlive the temporary worktree commit object
      // it names. That is unavailable lineage, not fresh evidence.
      return false;
    }
    throw error;
  }
}

/**
 * Distinguish post-repair evidence from artifacts written later by the same
 * pre-restart daemon or by a concurrent branch based before the repair.
 */
export async function inspectCalibrationRepairFreshness(
  workspaceRoot: string,
  repairedTaskPath: string,
  repairTaskId: string,
  runCommand: WorkflowCommandRunner,
): Promise<CalibrationRepairFreshness> {
  const repairRevision = await gitOutput(
    workspaceRoot,
    ["log", "-1", "--format=%H", "--", repairedTaskPath],
    runCommand,
  );
  if (repairRevision === null || !GIT_REVISION.test(repairRevision)) {
    return { status: "untracked-repair" };
  }

  const runsDir = join(workspaceRoot, ".kota", "runs");
  const runsStats = lstatSync(runsDir, { throwIfNoEntry: false });
  if (
    runsStats?.isDirectory() &&
    !runsStats.isSymbolicLink()
  ) {
    const entries = readdirSync(runsDir, { withFileTypes: true })
      .sort((left, right) => right.name.localeCompare(left.name));
    for (const entry of entries) {
      if (entry.isSymbolicLink() || !entry.isDirectory()) continue;
      const artifact = readBoundCalibrationArtifact(runsDir, entry.name);
      if (artifact === null) continue;
      const sourceRevision = artifact.sourceRevision;
      if (!sourceRevision || !GIT_REVISION.test(sourceRevision)) continue;
      if (
        sourceRevision === repairRevision &&
        artifact.taskId === repairTaskId
      ) {
        continue;
      }
      if (
        await isAncestor(
          workspaceRoot,
          repairRevision,
          sourceRevision,
          runCommand,
        )
      ) {
        return {
          status: "descendant-observed",
          repairRevision,
          runId: artifact.runId,
          sourceRevision,
        };
      }
    }
  }

  return { status: "awaiting-descendant", repairRevision };
}
