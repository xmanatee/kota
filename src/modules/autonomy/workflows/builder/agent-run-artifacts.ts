import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import {
  type CommitResult,
  checkCommitStageable,
  commitWorkflowChanges,
  type WorkflowCommitPathPolicy,
} from "#modules/autonomy/commit.js";
import { stageWorkflowPaths } from "#modules/autonomy/commit-git.js";
import {
  type BuilderEvidenceInspection,
  inspectBuilderEvidence,
} from "./agent-run-evidence-policy.js";
import { isBuilderPathInside } from "./workspace.js";

function ensureRealDirectory(path: string): void {
  const existing = lstatSync(path, { throwIfNoEntry: false });
  if (existing === undefined) {
    mkdirSync(path);
    return;
  }
  if (!existing.isDirectory() || existing.isSymbolicLink()) {
    throw new Error(`Builder evidence projection path must be a real directory: ${path}`);
  }
}

function ensureDirectoryChain(workspaceRoot: string, target: string): void {
  if (!isBuilderPathInside(workspaceRoot, target)) {
    throw new Error(`Builder evidence projection escaped the workspace: ${target}`);
  }
  const relativeTarget = relative(workspaceRoot, target);
  let current = workspaceRoot;
  for (const part of relativeTarget.split(sep)) {
    current = join(current, part);
    ensureRealDirectory(current);
  }
}

function toGitPath(path: string): string {
  return path.split(sep).join("/");
}

function listExistingProjectionFiles(
  workspaceRoot: string,
  projectionRoot: string,
): string[] {
  const rootStats = lstatSync(projectionRoot, { throwIfNoEntry: false });
  if (rootStats === undefined) return [];
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
    throw new Error(
      `Builder evidence projection path must be a real directory: ${projectionRoot}`,
    );
  }

  const paths: string[] = [];
  function visit(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolutePath);
        continue;
      }
      const stats = lstatSync(absolutePath);
      if (!entry.isFile() || entry.isSymbolicLink() || stats.nlink !== 1) {
        throw new Error(
          `Builder evidence projection contains a non-private file: ${absolutePath}`,
        );
      }
      paths.push(toGitPath(relative(workspaceRoot, absolutePath)));
    }
  }
  visit(projectionRoot);
  return paths;
}

function builderEvidenceProjectionPaths(
  workspaceDir: string,
  agentRunDir: string,
  evidence: BuilderEvidenceInspection,
): string[] {
  const workspaceRoot = resolve(workspaceDir);
  const projectionRoot = join(
    workspaceRoot,
    ".kota",
    "runs",
    basename(agentRunDir),
    "evidence",
  );
  return evidence.files.map((file) =>
    toGitPath(
      relative(workspaceRoot, join(projectionRoot, file.relativeEvidencePath)),
    )
  );
}

function builderCommitPathPolicy(
  projectedPaths: readonly string[],
): WorkflowCommitPathPolicy {
  return {
    kind: "all-mutated-paths-with-boundaries",
    excludedPathRoots: [".kota/builder-evidence", ".kota/runs"],
    allowedPaths: projectedPaths,
  };
}

function projectBuilderEvidence(
  workspaceDir: string,
  agentRunDir: string,
): string[] {
  const workspaceRoot = resolve(workspaceDir);
  const evidence = inspectBuilderEvidence(agentRunDir, workspaceRoot);
  const projectedPaths = builderEvidenceProjectionPaths(
    workspaceRoot,
    agentRunDir,
    evidence,
  );
  const projectionRoot = join(
    workspaceRoot,
    ".kota",
    "runs",
    basename(agentRunDir),
    "evidence",
  );
  ensureDirectoryChain(workspaceRoot, dirname(projectionRoot));
  const projectedPathSet = new Set(projectedPaths);
  const unexpectedPaths = listExistingProjectionFiles(
    workspaceRoot,
    projectionRoot,
  ).filter((path) => !projectedPathSet.has(path));
  if (unexpectedPaths.length > 0) {
    throw new Error(
      `Builder evidence projection contains unregistered file(s): ${unexpectedPaths.join(", ")}`,
    );
  }
  ensureDirectoryChain(workspaceRoot, projectionRoot);

  for (const file of evidence.files) {
    const destination = join(projectionRoot, file.relativeEvidencePath);
    ensureDirectoryChain(workspaceRoot, dirname(destination));
    const existing = lstatSync(destination, { throwIfNoEntry: false });
    if (
      existing !== undefined &&
      (!existing.isFile() || existing.isSymbolicLink() || existing.nlink !== 1)
    ) {
      throw new Error(
        `Builder evidence projection target must be a private regular file: ${destination}`,
      );
    }
    writeFileSync(destination, file.projectedContent, { mode: 0o600 });
    chmodSync(destination, 0o600);
  }
  stageWorkflowPaths(workspaceRoot, projectedPaths, {
    includeIgnored: true,
  });
  return projectedPaths;
}

export function checkAgentRunArtifactsReady(
  agentRunDir: string,
  workspaceDir: string,
): string {
  const evidence = inspectBuilderEvidence(agentRunDir, workspaceDir);
  return `OK: ${evidence.fileCount} registered builder evidence file(s), ${evidence.totalBytes} byte(s) ready`;
}

export function projectAgentRunArtifactsForValidation(
  agentRunDir: string,
  workspaceDir: string,
): string {
  const projectedPaths = projectBuilderEvidence(workspaceDir, agentRunDir);
  return `OK: ${projectedPaths.length} screened builder evidence file(s) projected and staged`;
}

export function checkBuilderWorkflowChangesStageable(
  workspaceDir: string,
  agentRunDir: string,
): string {
  const evidence = inspectBuilderEvidence(agentRunDir, workspaceDir);
  const projectedPaths = builderEvidenceProjectionPaths(
    workspaceDir,
    agentRunDir,
    evidence,
  );
  return checkCommitStageable(
    workspaceDir,
    builderCommitPathPolicy(projectedPaths),
  );
}

export function commitBuilderWorkflowChanges(
  workspaceDir: string,
  agentRunDir: string,
): CommitResult {
  const projectedPaths = projectBuilderEvidence(workspaceDir, agentRunDir);
  return commitWorkflowChanges(
    workspaceDir,
    agentRunDir,
    builderCommitPathPolicy(projectedPaths),
  );
}
