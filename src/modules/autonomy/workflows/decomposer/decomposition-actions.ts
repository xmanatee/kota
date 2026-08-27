import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  serializeFlatFrontMatter,
  splitFrontMatter,
} from "#core/util/frontmatter.js";
import {
  normalizeGeneratedTaskScalar,
  renderGeneratedTaskProse,
} from "#modules/autonomy/generated-task-text.js";
import { renderRepoTaskIntent } from "#modules/repo-tasks/repo-task-intent.js";
import {
  extractTaskSections,
  getRepoTaskContainerDir,
  moveTaskById,
  writeRepoTaskFile,
} from "#modules/repo-tasks/repo-tasks-domain.js";
import {
  showTask,
  slugifyTaskTitle,
  updateTaskBody,
} from "#modules/repo-tasks/repo-tasks-operations.js";
import { checkDecompositionApplied } from "./decomposition-check.js";
import type { DecompositionPlan } from "./decomposition-plan.js";

const GENERATED_TASK_SOURCE = "decomposer subtask";

export type AppliedDecomposition = {
  taskId: string;
  subtaskIds: string[];
};

function normalizeScalar(field: string, value: string): string {
  return normalizeGeneratedTaskScalar(GENERATED_TASK_SOURCE, field, value);
}

function renderList(values: readonly string[]): string {
  return values
    .map((value) => {
      const lines = renderGeneratedTaskProse(value)
        .split("\n")
        .map((line) => line.trimStart());
      return [`- ${lines[0]}`, ...lines.slice(1).map((line) => `  ${line}`)].join(
        "\n",
      );
    })
    .join("\n");
}

function subtaskBody(args: {
  taskId: string;
  failedRunId: string;
  problem: string;
  desiredOutcome: string;
  constraints: readonly string[];
  howWeWillKnow: readonly string[];
}): string {
  return renderRepoTaskIntent({
    problem: renderGeneratedTaskProse(args.problem),
    desiredOutcome: renderGeneratedTaskProse(args.desiredOutcome),
    constraints: renderList(args.constraints),
    howWeWillKnow: renderList(args.howWeWillKnow),
    context:
      `Decomposed from \`${args.taskId}\` after builder run ` +
      `\`${args.failedRunId}\` exhausted repair.`,
  });
}

export function applyDecompositionPlan(args: {
  workspaceRoot: string;
  taskId: string;
  failedRunId: string;
  plan: DecompositionPlan;
}): AppliedDecomposition {
  const original = showTask(args.workspaceRoot, args.taskId);
  if (!original.found || original.state === "done" || original.state === "dropped") {
    throw new Error(`Active task ${args.taskId} is unavailable for decomposition`);
  }
  const originalFrontMatter = splitFrontMatter(original.content);
  if (!originalFrontMatter) {
    throw new Error(`Task ${args.taskId} has malformed frontmatter`);
  }
  const originalBody = originalFrontMatter.body;
  if (extractTaskSections(originalBody, ["Decomposed"]).Decomposed) {
    throw new Error(`Task ${args.taskId} already records a decomposition`);
  }
  const droppedPath = join(
    getRepoTaskContainerDir(args.workspaceRoot, "dropped"),
    `${args.taskId}.md`,
  );
  if (existsSync(droppedPath)) {
    throw new Error(`Task ${args.taskId} already has a dropped-state file`);
  }

  const subtasks = args.plan.subtasks.map((task) => ({
    ...task,
    title: normalizeScalar("title", task.title),
  }));
  const subtaskIds = subtasks.map((task) => `task-${slugifyTaskTitle(task.title)}`);
  if (subtaskIds.includes("task-")) {
    throw new Error("Decomposer subtask title must produce a non-empty task id");
  }
  if (subtaskIds.includes(args.taskId)) {
    throw new Error(`Decomposer subtask id collides with ${args.taskId}`);
  }
  if (new Set(subtaskIds).size !== subtaskIds.length) {
    throw new Error("Decomposer subtask titles produce duplicate task ids");
  }
  for (const id of subtaskIds) {
    if (showTask(args.workspaceRoot, id).found) {
      throw new Error(`Decomposer subtask already exists: ${id}`);
    }
  }

  const openDir = getRepoTaskContainerDir(args.workspaceRoot, "open");
  for (const [index, task] of subtasks.entries()) {
    const id = subtaskIds[index]!;
    const dependsOn = [...new Set(task.dependsOn)].map(
      (dependencyIndex) => subtaskIds[dependencyIndex]!,
    );
    const attrs: Record<string, string | string[]> = {
      status: "open",
      priority: task.priority,
      ...(dependsOn.length > 0 ? { depends_on: dependsOn } : {}),
    };
    writeRepoTaskFile(
      args.workspaceRoot,
      join(openDir, `${id}.md`),
      serializeFlatFrontMatter(
        attrs,
        `# ${task.title}\n\n${subtaskBody({
          taskId: args.taskId,
          failedRunId: args.failedRunId,
          problem: task.problem,
          desiredOutcome: task.desiredOutcome,
          constraints: task.constraints,
          howWeWillKnow: task.howWeWillKnow,
        })}`,
      ),
    );
  }

  const update = updateTaskBody(
    args.workspaceRoot,
    args.taskId,
    `${originalBody.trim()}\n\n## Decomposed\n\n${subtaskIds.map((id) => `- ${id}`).join("\n")}`,
  );
  if (!update.ok) {
    throw new Error(`Could not annotate ${args.taskId} before decomposition: ${update.reason}`);
  }
  moveTaskById(args.workspaceRoot, args.taskId, "dropped");
  checkDecompositionApplied(args.workspaceRoot, args.taskId);
  return { taskId: args.taskId, subtaskIds };
}
