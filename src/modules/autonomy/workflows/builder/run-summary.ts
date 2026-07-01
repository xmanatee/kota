import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { withProtectedGitBareRepositoryEnv } from "#core/util/protected-git-env.js";
import type { WorkflowStepContext } from "#core/workflow/run-types.js";
import { writeDiffSummaryConsistencyArtifact } from "#modules/autonomy/diff-summary-consistency.js";
import type { ObservabilityObligationReview } from "#modules/autonomy/observability-obligation.js";
import { readObservabilityObligationReviewArtifact } from "#modules/autonomy/observability-obligation.js";
import { type WorkflowRunSummary, writeRunSummary } from "#modules/autonomy/run-summary.js";
import {
  extractSourceFileSizeWarningsFromBuildOutput,
  type SourceFileSizeWarning,
} from "#modules/autonomy/source-size-check.js";
import type { SourceFileSizeReview } from "#modules/autonomy/source-size-escalation.js";
import { readSourceFileSizeReviewArtifact } from "#modules/autonomy/source-size-review-artifact.js";
import { REPO_TASKS_DIR } from "#modules/repo-tasks/repo-tasks-domain.js";

export type BuilderRunSummary = WorkflowRunSummary & {
  observabilityObligations?: ObservabilityObligationReview;
  sourceFileSize?: SourceFileSizeReview;
  warnings?: SourceFileSizeWarning[];
};

/** Terminal states indicate the task the builder actually completed. */
const TERMINAL_TASK_STATES = ["done", "blocked", "dropped"];
const TERMINAL_TASK_STATE_SET = new Set(TERMINAL_TASK_STATES);

export type ChangedTaskFile = {
  file: string;
  taskId: string;
  taskTitle: string | null;
  becameTerminal: boolean;
};

function isTerminalTaskFile(file: string): boolean {
  return TERMINAL_TASK_STATES.some((state) => file.includes(`/${state}/`));
}

function gitResult(projectDir: string, args: readonly string[]) {
  return spawnSync("git", [...args], {
    cwd: projectDir,
    env: withProtectedGitBareRepositoryEnv(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
}

function gitRefExists(projectDir: string, ref: string): boolean {
  const result = gitResult(projectDir, ["rev-parse", "--verify", ref]);
  if (result.error !== undefined) throw result.error;
  return result.status === 0;
}

function hasChangesAgainstHead(projectDir: string): boolean {
  const result = gitResult(projectDir, ["diff", "--quiet", "HEAD", "--"]);
  if (result.error !== undefined) throw result.error;
  return result.status !== 0;
}

function comparisonRef(projectDir: string): string | null {
  if (!gitRefExists(projectDir, "HEAD")) return null;
  if (hasChangesAgainstHead(projectDir)) return "HEAD";
  return gitRefExists(projectDir, "HEAD~1") ? "HEAD~1" : "HEAD";
}

function readGitFile(projectDir: string, ref: string, file: string): string | null {
  const result = gitResult(projectDir, ["show", `${ref}:${file}`]);
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) return null;
  return result.stdout;
}

function parseTaskMetadata(content: string): {
  taskId: string | null;
  taskTitle: string | null;
  status: string | null;
} {
  const idMatch = content.match(/^id:\s+(.+)$/m);
  const titleMatch = content.match(/^title:\s+(.+)$/m);
  const statusMatch = content.match(/^status:\s+(.+)$/m);
  return {
    taskId: idMatch ? idMatch[1].trim() : null,
    taskTitle: titleMatch ? titleMatch[1].trim() : null,
    status: statusMatch ? statusMatch[1].trim() : null,
  };
}

function wasTerminalTaskAtRef(projectDir: string, ref: string | null, file: string): boolean {
  if (ref === null) return false;
  const oldContent = readGitFile(projectDir, ref, file);
  if (oldContent === null) return false;
  const oldStatus = parseTaskMetadata(oldContent).status;
  return isTerminalTaskFile(file) || (oldStatus !== null && TERMINAL_TASK_STATE_SET.has(oldStatus));
}

export function findTerminalTasksInChangedFiles(
  projectDir: string,
  files: string[],
): ChangedTaskFile[] {
  const ref = comparisonRef(projectDir);
  const taskFiles = files.filter(
    (f) =>
      f.startsWith(`${REPO_TASKS_DIR}/`) &&
      f.endsWith(".md") &&
      !f.endsWith("AGENTS.md") &&
      isTerminalTaskFile(f),
  );

  const tasks: ChangedTaskFile[] = [];
  for (const file of taskFiles) {
    try {
      const content = readFileSync(join(projectDir, file), "utf-8");
      const metadata = parseTaskMetadata(content);
      if (metadata.taskId !== null) {
        tasks.push({
          file,
          taskId: metadata.taskId,
          taskTitle: metadata.taskTitle,
          becameTerminal: !wasTerminalTaskAtRef(projectDir, ref, file),
        });
      }
    } catch {
      // file may no longer exist at this path (e.g. moved via git mv — old path)
    }
  }
  return tasks;
}

function primaryTask(tasks: ChangedTaskFile[]): {
  taskId: string | null;
  taskTitle: string | null;
} {
  const becameTerminal = tasks.filter((task) => task.becameTerminal);
  const candidates = becameTerminal.length > 0 ? becameTerminal : tasks;
  const task = candidates[0];
  return task
    ? { taskId: task.taskId, taskTitle: task.taskTitle }
    : { taskId: null, taskTitle: null };
}

export function findTaskInChangedFiles(
  projectDir: string,
  files: string[],
): { taskId: string | null; taskTitle: string | null } {
  const taskFiles = files.filter(
    (f) => f.startsWith(`${REPO_TASKS_DIR}/`) && f.endsWith(".md") && !f.endsWith("AGENTS.md"),
  );

  // Prefer tasks in terminal states — those are the ones the builder completed.
  // Newly-created backlog/ready tasks are follow-ups, not the primary work.
  const sorted = [...taskFiles].sort((a, b) => {
    const aTerminal = isTerminalTaskFile(a);
    const bTerminal = isTerminalTaskFile(b);
    if (aTerminal !== bTerminal) return aTerminal ? -1 : 1;
    return 0;
  });

  const terminalTasks = findTerminalTasksInChangedFiles(projectDir, sorted);
  if (terminalTasks.length > 0) return primaryTask(terminalTasks);

  for (const file of sorted) {
    try {
      const content = readFileSync(join(projectDir, file), "utf-8");
      const metadata = parseTaskMetadata(content);
      if (metadata.taskId !== null) {
        return {
          taskId: metadata.taskId,
          taskTitle: metadata.taskTitle,
        };
      }
    } catch {
      // file may no longer exist at this path (e.g. moved via git mv — old path)
    }
  }
  return { taskId: null, taskTitle: null };
}

export function findTerminalTaskInChangedFiles(
  projectDir: string,
  files: string[],
): { taskId: string | null; taskTitle: string | null } {
  return primaryTask(findTerminalTasksInChangedFiles(projectDir, files));
}

export function writeBuilderRunSummary(ctx: WorkflowStepContext): BuilderRunSummary {
  const summary = writeRunSummary(ctx, "build", findTaskInChangedFiles);
  const repoDir = ctx.workspaceDir ?? ctx.projectDir;
  const observabilityObligations = readObservabilityObligationReviewArtifact(
    ctx.workflow.runDirPath,
  );
  const sourceFileSize = readSourceFileSizeReviewArtifact(ctx.workflow.runDirPath);
  const warnings = extractSourceFileSizeWarningsFromBuildOutput(
    ctx.stepOutputs.build as { repairWarnings?: readonly { id?: string; output?: string }[] } | undefined,
  );
  if (
    warnings.length === 0 &&
    (sourceFileSize === null || sourceFileSize.outcome === "ok") &&
    (observabilityObligations === null ||
      observabilityObligations.candidates.length === 0)
  ) {
    writeDiffSummaryConsistencyArtifact(
      repoDir,
      ctx.workflow.runDirPath,
      summary,
    );
    return summary;
  }

  const builderSummary: BuilderRunSummary = {
    ...summary,
    ...(observabilityObligations !== null &&
    observabilityObligations.candidates.length > 0
      ? { observabilityObligations }
      : {}),
    ...(sourceFileSize !== null && sourceFileSize.outcome !== "ok" ? { sourceFileSize } : {}),
    ...(warnings.length > 0 ? { warnings } : {}),
  };
  writeFileSync(
    join(ctx.workflow.runDirPath, "run-summary.json"),
    JSON.stringify(builderSummary, null, 2),
  );
  writeDiffSummaryConsistencyArtifact(
    repoDir,
    ctx.workflow.runDirPath,
    builderSummary,
  );
  return builderSummary;
}
