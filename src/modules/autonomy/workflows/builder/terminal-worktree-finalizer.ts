import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { WorkflowTerminalFinalizerInput } from "#core/workflow/types.js";
import {
  inspectAutomationWorktree,
  listAutomationWorktreeUniqueCommits,
  reconcileAutomationWorktrees,
} from "#modules/git/worktree-lifecycle.js";
import type { BuilderWorkspaceResult } from "./prepare-worktree-step.js";

type BuilderTerminalWorktreeFinalizerArtifact = {
  attempted: boolean;
  reason: string;
  taskId: string | null;
  runId: string;
  removed: boolean;
  blockers: string[];
  uniqueCommits: string[];
  artifactPath: string;
};

function workspaceOutput(input: WorkflowTerminalFinalizerInput): BuilderWorkspaceResult | null {
  const step = input.metadata.steps.find((candidate) => candidate.id === "prepare-worktree");
  const output = step?.output;
  if (!output || typeof output !== "object") return null;
  const candidate = output as Partial<BuilderWorkspaceResult>;
  if (candidate.enabled !== true || typeof candidate.taskId !== "string") return null;
  return candidate as BuilderWorkspaceResult;
}

function writeArtifact(
  artifact: BuilderTerminalWorktreeFinalizerArtifact,
): void {
  mkdirSync(dirname(artifact.artifactPath), { recursive: true });
  writeFileSync(artifact.artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
}

export async function finalizeBuilderTerminalWorktree(
  input: WorkflowTerminalFinalizerInput,
): Promise<void> {
  const workspace = workspaceOutput(input);
  if (!workspace?.taskId) return;
  const runDirPath = join(input.projectDir, input.metadata.runDir);
  const artifactPath = join(runDirPath, "terminal-worktree-finalizer.json");
  if (input.metadata.status === "success" || input.metadata.status === "completed-with-warnings") {
    return;
  }

  const selector = {
    projectDir: input.projectDir,
    taskId: workspace.taskId,
    runId: input.metadata.id,
  };
  try {
    const before = inspectAutomationWorktree(selector);
    const unique = listAutomationWorktreeUniqueCommits(
      input.projectDir,
      before.branch || before.headCommit,
    );
    const reconciliation = reconcileAutomationWorktrees(input.projectDir);
    const item = reconciliation.items.find(
      (candidate) => candidate.taskId === workspace.taskId && candidate.runId === input.metadata.id,
    );
    const removed = item?.removed ?? false;
    const baseBlockers = item?.blockers ?? before.cleanup.blockers;
    const blockers =
      !removed && unique.error !== undefined
        ? [...baseBlockers, unique.error]
        : baseBlockers;
    const reason = removed
      ? "terminal builder worktree had no unresolved cleanup blockers"
      : "terminal builder worktree preserved for recovery review";
    writeArtifact({
      attempted: true,
      reason,
      taskId: workspace.taskId,
      runId: input.metadata.id,
      removed,
      blockers,
      uniqueCommits: unique.commits,
      artifactPath,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    input.log(`Builder terminal worktree finalizer preserved error artifact: ${message}`);
    writeArtifact({
      attempted: true,
      reason: message,
      taskId: workspace.taskId,
      runId: input.metadata.id,
      removed: false,
      blockers: [message],
      uniqueCommits: [],
      artifactPath,
    });
  }
}
