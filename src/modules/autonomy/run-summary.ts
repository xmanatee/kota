import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { WorkflowStepContext } from "#core/workflow/run-types.js";

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
    encoding: "utf-8",
    stdio: "pipe",
  }).trim();
}

export function writeRunSummary(
  ctx: WorkflowStepContext,
  agentStepId: string,
  findTask?: (projectDir: string, filesChanged: string[]) => { taskId: string | null; taskTitle: string | null },
): WorkflowRunSummary {
  const { projectDir, workflow, stepOutputs, stepResults } = ctx;

  const commitSha = git(projectDir, "rev-parse HEAD");
  const commitMessage = git(projectDir, "log --format=%s -1");
  const filesChanged = git(projectDir, "diff --name-only HEAD~1")
    .split("\n")
    .filter(Boolean);

  const { taskId, taskTitle } = findTask
    ? findTask(projectDir, filesChanged)
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
