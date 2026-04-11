import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_TASKS_DIR } from "#core/data/repo-tasks.js";
import type { WorkflowStepContext } from "#core/workflow/run-types.js";

export type BuilderRunSummary = {
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

/** Terminal states indicate the task the builder actually completed. */
const TERMINAL_TASK_STATES = ["done", "blocked", "dropped"];

function findTaskInChangedFiles(
  projectDir: string,
  files: string[],
): { taskId: string | null; taskTitle: string | null } {
  const taskFiles = files.filter(
    (f) => f.startsWith(`${REPO_TASKS_DIR}/`) && f.endsWith(".md") && !f.endsWith("AGENTS.md"),
  );

  // Prefer tasks in terminal states — those are the ones the builder completed.
  // Newly-created backlog/ready tasks are follow-ups, not the primary work.
  const sorted = [...taskFiles].sort((a, b) => {
    const aTerminal = TERMINAL_TASK_STATES.some((s) => a.includes(`/${s}/`));
    const bTerminal = TERMINAL_TASK_STATES.some((s) => b.includes(`/${s}/`));
    if (aTerminal !== bTerminal) return aTerminal ? -1 : 1;
    return 0;
  });

  for (const file of sorted) {
    try {
      const content = readFileSync(join(projectDir, file), "utf-8");
      const idMatch = content.match(/^id:\s+(.+)$/m);
      const titleMatch = content.match(/^title:\s+(.+)$/m);
      if (idMatch) {
        return {
          taskId: idMatch[1].trim(),
          taskTitle: titleMatch ? titleMatch[1].trim() : null,
        };
      }
    } catch {
      // file may no longer exist at this path (e.g. moved via git mv — old path)
    }
  }
  return { taskId: null, taskTitle: null };
}

export function writeBuilderRunSummary(ctx: WorkflowStepContext): BuilderRunSummary {
  const { projectDir, workflow, stepOutputs, stepResults } = ctx;

  const commitSha = execSync("git rev-parse HEAD", {
    cwd: projectDir,
    encoding: "utf-8",
    stdio: "pipe",
  }).trim();

  const commitMessage = execSync("git log --format=%s -1", {
    cwd: projectDir,
    encoding: "utf-8",
    stdio: "pipe",
  }).trim();

  const filesChanged = execSync("git diff --name-only HEAD~1", {
    cwd: projectDir,
    encoding: "utf-8",
    stdio: "pipe",
  })
    .trim()
    .split("\n")
    .filter(Boolean);

  const { taskId, taskTitle } = findTaskInChangedFiles(projectDir, filesChanged);

  const buildOutput = stepOutputs.build as Record<string, unknown> | undefined;
  const costUsd =
    typeof buildOutput?.totalCostUsd === "number" ? buildOutput.totalCostUsd : null;
  const durationMs =
    typeof stepResults.build?.durationMs === "number" ? stepResults.build.durationMs : null;

  const summary: BuilderRunSummary = {
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
