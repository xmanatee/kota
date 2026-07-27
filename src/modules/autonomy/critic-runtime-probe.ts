import { spawnSync } from "node:child_process";
import {
  lstatSync,
  realpathSync,
  type Stats,
} from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import { withProtectedGitBareRepositoryEnv } from "#core/util/protected-git-env.js";
import {
  type FileIdentity,
  writeAnchoredRuntimeProbeArtifact,
} from "./critic-runtime-probe-artifact-writer.js";
import {
  extractTaskProbe,
  rejectedTaskProbeResult,
  runTaskProbe,
  type TaskProbeResult,
  verifyTaskProbeProvenance,
} from "./task-probe.js";

const RUNTIME_PROBE_ARTIFACT = "runtime-probe.json";

type ArtifactLocation = {
  artifactPath: string;
  runDirectoryIdentity: FileIdentity;
  runRoot: string;
  workspacePath: string;
  workspaceRoot: string;
};

export function runProbeIfDeclared(
  taskContent: string,
  taskPath: string,
  projectDir: string,
  runDir: string,
  artifactWorkspaceDir?: string,
): TaskProbeResult | null {
  const probe = extractTaskProbe(taskContent);
  if (!probe) return null;

  if (artifactWorkspaceDir !== undefined) {
    assertArtifactPathStageable(
      resolveArtifactLocation(artifactWorkspaceDir, runDir),
    );
  }

  const provenance = verifyTaskProbeProvenance({ projectDir, taskPath, probe });
  if (provenance.status === "untrusted") {
    const result = rejectedTaskProbeResult(probe, provenance.reason);
    writeRuntimeProbeArtifact(
      artifactWorkspaceDir ?? projectDir,
      runDir,
      result,
      artifactWorkspaceDir !== undefined,
    );
    throw new Error(`Runtime Probe not executed: ${provenance.reason}`);
  }

  const result = {
    ...runTaskProbe(probe, projectDir),
    provenance,
  };
  writeRuntimeProbeArtifact(
    artifactWorkspaceDir ?? projectDir,
    runDir,
    result,
    artifactWorkspaceDir !== undefined,
  );
  return result;
}

function isOutsideDirectory(directory: string, candidate: string): boolean {
  const path = relative(directory, candidate);
  return path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path);
}

function assertRealDirectoryPath(
  workspaceRoot: string,
  runRoot: string,
): void {
  const relativeRunRoot = relative(workspaceRoot, runRoot);
  let current = workspaceRoot;
  for (const segment of ["", ...relativeRunRoot.split(sep).filter(Boolean)]) {
    if (segment !== "") current = join(current, segment);
    const stats = lstatSync(current);
    if (stats.isSymbolicLink()) {
      throw new Error(
        `Runtime Probe artifact path must not traverse symbolic links: ${current}`,
      );
    }
    if (!stats.isDirectory()) {
      throw new Error(
        `Runtime Probe artifact path must traverse directories: ${current}`,
      );
    }
  }
}

function resolveArtifactLocation(
  workspaceDir: string,
  runDir: string,
): ArtifactLocation {
  const workspaceRoot = realpathSync.native(workspaceDir);
  const runRoot = realpathSync.native(runDir);
  if (isOutsideDirectory(workspaceRoot, runRoot)) {
    throw new Error(
      `Runtime Probe run directory must be inside the active workspace: ${runDir}`,
    );
  }
  assertRealDirectoryPath(workspaceRoot, runRoot);
  const runStats = lstatSync(runRoot);
  if (!runStats.isDirectory() || runStats.isSymbolicLink()) {
    throw new Error(
      `Runtime Probe run directory must be a real directory: ${runDir}`,
    );
  }

  const artifactPath = join(runRoot, RUNTIME_PROBE_ARTIFACT);
  const workspacePath = relative(workspaceRoot, artifactPath);
  if (workspacePath === "" || isOutsideDirectory(workspaceRoot, artifactPath)) {
    throw new Error(
      `Runtime Probe artifact must be inside the active workspace: ${artifactPath}`,
    );
  }
  return {
    artifactPath,
    runDirectoryIdentity: identity(runStats),
    runRoot,
    workspacePath,
    workspaceRoot,
  };
}

function assertArtifactPathStageable(location: ArtifactLocation): void {
  const ignored = spawnSync(
    "git",
    ["check-ignore", "--quiet", "--no-index", "--", location.workspacePath],
    {
      cwd: location.workspaceRoot,
      env: withProtectedGitBareRepositoryEnv(),
      encoding: "utf8",
    },
  );
  if (ignored.status === 0) {
    throw new Error(
      `Runtime Probe artifact is ignored and cannot be committed: ${location.workspacePath}`,
    );
  }
  if (ignored.status !== 1) {
    const detail = [ignored.stdout, ignored.stderr]
      .filter((value) => value.length > 0)
      .join("\n")
      .trim();
    throw new Error(
      `Could not verify Runtime Probe artifact path with git check-ignore: ${location.workspacePath}${detail ? `\n${detail}` : ""}`,
    );
  }
}

function assertPrivateRegularFile(stats: Stats, artifactPath: string): void {
  if (!stats.isFile()) {
    throw new Error(
      `Runtime Probe artifact must be a regular file: ${artifactPath}`,
    );
  }
  if (stats.nlink !== 1) {
    throw new Error(
      `Runtime Probe artifact must not have multiple hard links: ${artifactPath}`,
    );
  }
}

function inspectExistingArtifact(artifactPath: string): Stats | undefined {
  const stats = lstatSync(artifactPath, { throwIfNoEntry: false });
  if (stats === undefined) return undefined;
  if (stats.isSymbolicLink()) {
    throw new Error(
      `Runtime Probe artifact must not be a symbolic link: ${artifactPath}`,
    );
  }
  assertPrivateRegularFile(stats, artifactPath);
  return stats;
}

function identity(stats: Stats): FileIdentity {
  return { dev: stats.dev, ino: stats.ino };
}

function writeRuntimeProbeArtifact(
  workspaceDir: string,
  runDir: string,
  result: TaskProbeResult,
  requireStageable: boolean,
): void {
  const location = resolveArtifactLocation(workspaceDir, runDir);
  if (requireStageable) assertArtifactPathStageable(location);

  const expectedStats = inspectExistingArtifact(location.artifactPath);
  writeAnchoredRuntimeProbeArtifact({
    expectedArtifactIdentity:
      expectedStats === undefined ? null : identity(expectedStats),
    runDirectoryIdentity: location.runDirectoryIdentity,
    runDirectoryPath: location.runRoot,
    serializedArtifact: JSON.stringify(result, null, 2),
  });
}
