import { lstatSync } from "node:fs";
import { basename, join, relative, resolve, sep } from "node:path";
import {
  type CommitResult,
  checkCommitStageable,
  commitWorkflowChanges,
  type WorkflowCommitPathPolicy,
} from "#modules/autonomy/commit.js";
import { stageWorkflowPaths } from "#modules/autonomy/commit-git.js";
import {
  listStableBuilderEvidenceDirectory,
  writeStableBuilderEvidenceProjection,
} from "./agent-run-evidence-filesystem-helper.js";
import {
  type BuilderEvidenceInspection,
  inspectBuilderEvidence,
} from "./agent-run-evidence-policy.js";

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
    for (const entry of listStableBuilderEvidenceDirectory(workspaceRoot, directory)) {
      const absolutePath = join(directory, entry.name);
      if (entry.kind === "directory") {
        visit(absolutePath);
        continue;
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
  for (const file of evidence.files) {
    const destination = join(projectionRoot, file.relativeEvidencePath);
    writeStableBuilderEvidenceProjection(
      workspaceRoot,
      destination,
      file.projectedContent,
    );
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
