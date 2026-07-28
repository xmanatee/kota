import { lstatSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import {
  type CommitResult,
  commitWorkflowChanges,
  stageWorkflowPaths,
} from "#modules/autonomy/commit.js";
import { isBuilderPathInside } from "./workspace.js";

const REQUIRED_AGENT_RUN_ARTIFACTS = [
  "success-criteria.txt",
  "success-criteria-verified.txt",
  "commit-message.txt",
] as const;

type AgentRunArtifacts = {
  fileCount: number;
  relativeRunDir: string;
};

function listRegularFiles(directory: string): string[] {
  const paths: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      paths.push(...listRegularFiles(path));
    } else if (entry.isFile()) {
      paths.push(path);
    } else {
      throw new Error(`Builder run evidence must be a regular file or directory: ${path}`);
    }
  }
  return paths;
}

function inspectAgentRunArtifacts(
  agentRunDir: string,
  workspaceDir: string,
): AgentRunArtifacts {
  const workspaceRoot = resolve(workspaceDir);
  const runRoot = resolve(agentRunDir);
  if (runRoot === workspaceRoot || !isBuilderPathInside(workspaceRoot, runRoot)) {
    throw new Error(`Builder run directory is outside the active workspace: ${agentRunDir}`);
  }

  const runStats = lstatSync(runRoot);
  if (!runStats.isDirectory() || runStats.isSymbolicLink()) {
    throw new Error(`Builder run evidence path must be a real directory: ${agentRunDir}`);
  }

  return {
    fileCount: listRegularFiles(runRoot).length,
    relativeRunDir: relative(workspaceRoot, runRoot),
  };
}

export function checkAgentRunArtifactsReady(
  agentRunDir: string,
  workspaceDir: string,
): string {
  const missing: string[] = [];
  for (const name of REQUIRED_AGENT_RUN_ARTIFACTS) {
    const filePath = join(agentRunDir, name);
    const stats = lstatSync(filePath, { throwIfNoEntry: false });
    if (stats === undefined) {
      missing.push(filePath);
    } else if (!stats.isFile()) {
      throw new Error(`Required agent run artifact must be a regular file: ${filePath}`);
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `Required agent run artifact(s) are missing:\n${missing.map((p) => `  ${p}`).join("\n")}`,
    );
  }

  const artifacts = inspectAgentRunArtifacts(agentRunDir, workspaceDir);
  return `OK: ${artifacts.fileCount} builder run evidence file(s) ready`;
}

export function commitBuilderWorkflowChanges(
  workspaceDir: string,
  agentRunDir: string,
): CommitResult {
  const artifacts = inspectAgentRunArtifacts(agentRunDir, workspaceDir);
  stageWorkflowPaths(workspaceDir, [artifacts.relativeRunDir], {
    includeIgnored: true,
  });
  return commitWorkflowChanges(workspaceDir, agentRunDir);
}
