import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_TASKS_DIR } from "#core/data/repo-tasks.js";
import type { WorkflowStepContext } from "#core/workflow/run-types.js";
import { type WorkflowRunSummary, writeRunSummary } from "#modules/autonomy/run-summary.js";

export type BuilderRunSummary = WorkflowRunSummary;

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
  return writeRunSummary(ctx, "build", findTaskInChangedFiles);
}
