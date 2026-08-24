import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  parseFlatFrontMatter,
  serializeFlatFrontMatter,
  splitFrontMatter,
} from "#core/util/frontmatter.js";
import {
  normalizeGeneratedTaskScalar,
  renderGeneratedTaskProse,
} from "#modules/autonomy/generated-task-text.js";
import {
  extractTaskSections,
  getRepoTaskStateDir,
  moveTaskById,
  writeRepoTaskFile,
} from "#modules/repo-tasks/repo-tasks-domain.js";
import {
  showTask,
  updateTaskBody,
} from "#modules/repo-tasks/repo-tasks-operations.js";
import { readTaskDependencyIds } from "#modules/repo-tasks/task-dependencies.js";
import { checkDecompositionApplied } from "./decomposition-check.js";
import type { DecompositionPlan } from "./decomposition-plan.js";
import { resolveDecompositionTargets } from "./decomposition-target-resolution.js";
import {
  addDecompositionSource,
  decompositionTaskPath,
} from "./decomposition-task-reuse.js";

const GENERATED_TASK_SOURCE = "decomposer subtask";

export type AppliedDecomposition = {
  taskId: string;
  subtaskIds: string[];
  mutatedTaskPaths: string[];
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
  taskClass: DecompositionPlan["subtasks"][number]["taskClass"];
  problem: string;
  desiredOutcome: string;
  constraints: readonly string[];
  doneWhen: readonly string[];
  sourceIntent: string;
  initiative: string;
  acceptanceEvidence: readonly string[];
}): string {
  return [
    "",
    "## Problem",
    "",
    renderGeneratedTaskProse(args.problem),
    "",
    "## Desired Outcome",
    "",
    renderGeneratedTaskProse(args.desiredOutcome),
    "",
    "## Constraints",
    "",
    renderList(args.constraints),
    "",
    "## Done When",
    "",
    renderList(args.doneWhen),
    "",
    "## Source / Intent",
    "",
    renderGeneratedTaskProse(args.sourceIntent),
    "",
    `Decomposed from \`${args.taskId}\` after builder run \`${args.failedRunId}\` exhausted repair.`,
    "",
    ...(args.taskClass === "Meta"
      ? [
        "## Product / Safety Link",
        "",
        `This recovery task unblocks the Product or Safety intent preserved by \`${args.taskId}\`.`,
        "",
      ]
      : []),
    "## Initiative",
    "",
    renderGeneratedTaskProse(args.initiative),
    "",
    "## Acceptance Evidence",
    "",
    renderList(args.acceptanceEvidence),
    "",
  ].join("\n");
}

export function applyDecompositionPlan(args: {
  projectDir: string;
  taskId: string;
  failedRunId: string;
  plan: DecompositionPlan;
}): AppliedDecomposition {
  const original = showTask(args.projectDir, args.taskId);
  if (!original.found || original.state === "done" || original.state === "dropped") {
    throw new Error(`Active task ${args.taskId} is unavailable for decomposition`);
  }
  const originalFrontMatter = splitFrontMatter(original.content);
  if (!originalFrontMatter) {
    throw new Error(`Task ${args.taskId} has malformed frontmatter`);
  }
  const originalAttrs = parseFlatFrontMatter(original.content).attrs;
  const originalDependencies = readTaskDependencyIds(originalAttrs);
  const originalBody = originalFrontMatter.body;
  if (extractTaskSections(originalBody, ["Decomposed"]).Decomposed) {
    throw new Error(`Task ${args.taskId} already records a decomposition`);
  }
  const droppedPath = join(
    getRepoTaskStateDir(args.projectDir, "dropped"),
    `${args.taskId}.md`,
  );
  if (existsSync(droppedPath)) {
    throw new Error(`Task ${args.taskId} already has a dropped-state file`);
  }

  const subtasks = args.plan.subtasks.map((task) => ({
    ...task,
    title: normalizeScalar("title", task.title),
    summary: normalizeScalar("summary", task.summary),
    area: normalizeScalar("area", task.area),
  }));
  const targets = resolveDecompositionTargets({
    originalDependencies,
    parentTaskId: args.taskId,
    projectDir: args.projectDir,
    subtasks,
  });
  const subtaskIds = targets.map((target) => target.id);

  const readyDir = getRepoTaskStateDir(args.projectDir, "ready");
  const now = new Date().toISOString();
  const mutatedTaskPaths: string[] = [];
  for (const target of targets) {
    if (target.kind === "reuse") {
      const parsed = parseFlatFrontMatter(target.content);
      if (target.state === "doing") continue;
      const attrs = {
        ...parsed.attrs,
        ...(target.dependsOn.length > 0 ? { depends_on: target.dependsOn } : {}),
        updated_at: now,
      };
      const path = decompositionTaskPath(target.state, target.id);
      writeRepoTaskFile(
        args.projectDir,
        join(args.projectDir, path),
        serializeFlatFrontMatter(
          attrs,
          addDecompositionSource(parsed.body, args.taskId, args.failedRunId),
        ),
      );
      mutatedTaskPaths.push(path);
      continue;
    }

    const id = target.id;
    const attrs: Record<string, string | string[]> = {
      id,
      title: target.task.title,
      status: "ready",
      priority: target.task.priority,
      area: target.task.area,
      task_class: target.task.taskClass,
      summary: target.task.summary,
      ...(target.dependsOn.length > 0 ? { depends_on: target.dependsOn } : {}),
      created_at: now,
      updated_at: now,
    };
    writeRepoTaskFile(
      args.projectDir,
      join(readyDir, `${id}.md`),
      serializeFlatFrontMatter(
        attrs,
        subtaskBody({
          taskId: args.taskId,
          failedRunId: args.failedRunId,
          taskClass: target.task.taskClass,
          problem: target.task.problem,
          desiredOutcome: target.task.desiredOutcome,
          constraints: target.task.constraints,
          doneWhen: target.task.doneWhen,
          sourceIntent: target.task.sourceIntent,
          initiative: target.task.initiative,
          acceptanceEvidence: target.task.acceptanceEvidence,
        }),
      ),
    );
    mutatedTaskPaths.push(decompositionTaskPath("ready", id));
  }

  const update = updateTaskBody(
    args.projectDir,
    args.taskId,
    `${originalBody.trim()}\n\n## Decomposed\n\n${subtaskIds.map((id) => `- ${id}`).join("\n")}`,
  );
  if (!update.ok) {
    throw new Error(`Could not annotate ${args.taskId} before decomposition: ${update.reason}`);
  }
  moveTaskById(args.projectDir, args.taskId, "dropped");
  checkDecompositionApplied(args.projectDir, args.taskId, mutatedTaskPaths);
  return { taskId: args.taskId, subtaskIds, mutatedTaskPaths };
}
