import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { withProtectedGitBareRepositoryEnv } from "#core/util/protected-git-env.js";
import {
  extractTaskProbe,
  rejectedTaskProbeResult,
  runTaskProbe,
  type TaskProbeResult,
  verifyTaskProbeProvenance,
} from "./task-probe.js";

export function runProbeIfDeclared(
  taskContent: string,
  taskPath: string,
  projectDir: string,
  runDir: string,
  artifactWorkspaceDir?: string,
): TaskProbeResult | null {
  const probe = extractTaskProbe(taskContent);
  if (!probe) return null;

  const artifactPath = join(runDir, "runtime-probe.json");
  if (artifactWorkspaceDir !== undefined) {
    assertArtifactPathStageable(artifactWorkspaceDir, artifactPath);
  }

  const provenance = verifyTaskProbeProvenance({ projectDir, taskPath, probe });
  if (provenance.status === "untrusted") {
    const result = rejectedTaskProbeResult(probe, provenance.reason);
    writeFileSync(artifactPath, JSON.stringify(result, null, 2));
    throw new Error(`Runtime Probe not executed: ${provenance.reason}`);
  }

  const result = {
    ...runTaskProbe(probe, projectDir),
    provenance,
  };
  writeFileSync(artifactPath, JSON.stringify(result, null, 2));
  return result;
}

function assertArtifactPathStageable(
  workspaceDir: string,
  artifactPath: string,
): void {
  const workspaceRoot = resolve(workspaceDir);
  const resolvedArtifact = resolve(artifactPath);
  const workspacePath = relative(workspaceRoot, resolvedArtifact);
  if (
    workspacePath === "" ||
    workspacePath === ".." ||
    workspacePath.startsWith("../") ||
    isAbsolute(workspacePath)
  ) {
    throw new Error(
      `Runtime Probe artifact must be inside the active workspace: ${artifactPath}`,
    );
  }

  const ignored = spawnSync(
    "git",
    ["check-ignore", "--quiet", "--no-index", "--", workspacePath],
    {
      cwd: workspaceRoot,
      env: withProtectedGitBareRepositoryEnv(),
      encoding: "utf8",
    },
  );
  if (ignored.status === 0) {
    throw new Error(
      `Runtime Probe artifact is ignored and cannot be committed: ${workspacePath}`,
    );
  }
  if (ignored.status !== 1) {
    const detail = [ignored.stdout, ignored.stderr]
      .filter((value) => value.length > 0)
      .join("\n")
      .trim();
    throw new Error(
      `Could not verify Runtime Probe artifact path with git check-ignore: ${workspacePath}${detail ? `\n${detail}` : ""}`,
    );
  }
}
