import { spawnSync } from "node:child_process";
import { lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { withProtectedGitBareRepositoryEnv } from "#core/util/protected-git-env.js";
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

function gitOutput(projectDir: string, args: readonly string[]): string | null {
  const result = spawnSync("git", [...args], {
    cwd: projectDir,
    env: withProtectedGitBareRepositoryEnv(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) return null;
  const output = result.stdout.trim();
  return output.length > 0 ? output : null;
}

function isAncestor(
  projectDir: string,
  ancestor: string,
  descendant: string,
): boolean {
  const result = spawnSync(
    "git",
    ["merge-base", "--is-ancestor", ancestor, descendant],
    {
      cwd: projectDir,
      env: withProtectedGitBareRepositoryEnv(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (result.error !== undefined) throw result.error;
  if (result.status === 0) return true;
  // A retained artifact can outlive the temporary worktree commit object it
  // names. That is unavailable lineage, not fresh post-repair evidence.
  return false;
}

/**
 * Distinguish post-repair evidence from artifacts written later by the same
 * pre-restart daemon or by a concurrent branch based before the repair.
 */
export function inspectCalibrationRepairFreshness(
  projectDir: string,
  repairedTaskPath: string,
  repairTaskId: string,
): CalibrationRepairFreshness {
  const repairRevision = gitOutput(projectDir, [
    "log",
    "-1",
    "--format=%H",
    "--",
    repairedTaskPath,
  ]);
  if (repairRevision === null || !GIT_REVISION.test(repairRevision)) {
    return { status: "untracked-repair" };
  }

  const runsDir = join(projectDir, ".kota", "runs");
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
      if (isAncestor(projectDir, repairRevision, sourceRevision)) {
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
