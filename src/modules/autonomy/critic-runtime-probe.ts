import {
  lstatSync,
  realpathSync,
  type Stats,
} from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import type { WorkflowCommandRunner } from "#core/workflow/workflow-command.js";
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
};

export async function runProbeIfDeclared(
  taskContent: string,
  taskPath: string,
  workspaceRoot: string,
  runDir: string,
  runCommand: WorkflowCommandRunner,
  artifactWorkspaceDir?: string,
): Promise<TaskProbeResult | null> {
  const probe = extractTaskProbe(taskContent);
  if (!probe) return null;

  const provenance = await verifyTaskProbeProvenance({
    workspaceRoot,
    taskPath,
    probe,
    runCommand,
  });
  if (provenance.status === "untrusted") {
    const result = rejectedTaskProbeResult(probe, provenance.reason);
    await writeRuntimeProbeArtifact(
      artifactWorkspaceDir ?? workspaceRoot,
      runDir,
      result,
      runCommand,
    );
    throw new Error(`Runtime Probe not executed: ${provenance.reason}`);
  }

  const result = {
    ...(await runTaskProbe(probe, workspaceRoot, runCommand)),
    provenance,
  };
  await writeRuntimeProbeArtifact(
    artifactWorkspaceDir ?? workspaceRoot,
    runDir,
    result,
    runCommand,
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
  };
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

async function writeRuntimeProbeArtifact(
  workspaceDir: string,
  runDir: string,
  result: TaskProbeResult,
  runCommand: WorkflowCommandRunner,
): Promise<void> {
  const location = resolveArtifactLocation(workspaceDir, runDir);
  const expectedStats = inspectExistingArtifact(location.artifactPath);
  await writeAnchoredRuntimeProbeArtifact(
    {
      expectedArtifactIdentity:
        expectedStats === undefined ? null : identity(expectedStats),
      runDirectoryIdentity: location.runDirectoryIdentity,
      runDirectoryPath: location.runRoot,
      serializedArtifact: JSON.stringify(result, null, 2),
    },
    runCommand,
  );
}
