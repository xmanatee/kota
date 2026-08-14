import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { withProtectedGitBareRepositoryEnv } from "#core/util/protected-git-env.js";
import type { WorkflowStepContext } from "#core/workflow/run-types.js";

export type WorkflowRunSummaryContext = Pick<
  WorkflowStepContext,
  "projectDir" | "stepOutputs" | "stepResults" | "workflow" | "workspaceDir"
>;

export type WorkflowRunSummary = {
  runId: string;
  workflow: string;
  taskId: string | null;
  taskTitle: string | null;
  outcome: "success";
  commitSha: string;
  commitMessage: string;
  filesChanged: string[];
  costUsd: number | null;
  durationMs: number | null;
  completedAt: string;
};

function git(projectDir: string, args: string): string {
  return execSync(`git ${args}`, {
    cwd: projectDir,
    env: withProtectedGitBareRepositoryEnv(),
    encoding: "utf-8",
    stdio: "pipe",
  }).trim();
}

export function writeRunSummary(
  ctx: WorkflowRunSummaryContext,
  agentStepId: string,
  findTask?: (projectDir: string, filesChanged: string[]) => { taskId: string | null; taskTitle: string | null },
): WorkflowRunSummary {
  const { workflow, stepOutputs, stepResults } = ctx;
  const repoDir = ctx.workspaceDir ?? ctx.projectDir;

  const commitSha = git(repoDir, "rev-parse HEAD");
  const commitMessage = git(repoDir, "log --format=%s -1");
  const filesChanged = git(repoDir, "diff --name-only HEAD~1")
    .split("\n")
    .filter(Boolean);

  const { taskId, taskTitle } = findTask
    ? findTask(repoDir, filesChanged)
    : { taskId: null, taskTitle: null };

  const agentOutput = stepOutputs[agentStepId] as Record<string, unknown> | undefined;
  const costUsd =
    typeof agentOutput?.totalCostUsd === "number" ? agentOutput.totalCostUsd : null;
  const durationMs =
    typeof stepResults[agentStepId]?.durationMs === "number"
      ? stepResults[agentStepId]!.durationMs!
      : null;

  const summary: WorkflowRunSummary = {
    runId: workflow.runId,
    workflow: workflow.name,
    taskId,
    taskTitle,
    outcome: "success",
    commitSha,
    commitMessage,
    filesChanged,
    costUsd,
    durationMs,
    completedAt: new Date().toISOString(),
  };

  writeFileSync(
    join(workflow.runDirPath, "run-summary.json"),
    JSON.stringify(summary, null, 2),
  );

  return summary;
}
