import { existsSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import {
  parseFlatFrontMatter,
  serializeFlatFrontMatter,
  splitFrontMatter,
} from "#core/util/frontmatter.js";
import { type RepositoryTextTree, readWorkingTextTree } from "#core/util/repository-tree.js";
import {
  normalizeGeneratedTaskScalar,
  renderGeneratedTaskProse,
} from "#modules/autonomy/generated-task-text.js";
import { renderRepoTaskIntent } from "#modules/repo-tasks/repo-task-intent.js";
import {
  extractRepoTaskTitle,
  extractTaskSections,
  getRepoTaskContainerDir,
  listFullRepoTasks,
  moveTaskById,
  writeRepoTaskFile,
} from "#modules/repo-tasks/repo-tasks-domain.js";
import {
  showTask,
  slugifyTaskTitle,
  updateTaskBody,
} from "#modules/repo-tasks/repo-tasks-operations.js";
import { assertTaskQueueValid } from "#modules/repo-tasks/task-queue-validation.js";
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
      `\`${args.failedRunId}\` exhausted repair. The archived parent task ` +
      `remains the authority for its original intent and acceptance evidence.`,
  });
}

export function applyDecompositionPlan(args: {
  workspaceRoot: string;
  taskId: string;
  failedRunId: string;
  plan: DecompositionPlan;
  heldTaskIds: readonly string[];
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
  const originalDependencies = parseFlatFrontMatter(original.content).attrs.depends_on;
  if (
    originalDependencies !== undefined &&
    !Array.isArray(originalDependencies)
  ) {
    throw new Error(`Task ${args.taskId} has malformed depends_on metadata`);
  }
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
  const subtaskIds = subtasks.map((task) =>
    task.reuseTaskId ?? `task-${slugifyTaskTitle(task.title)}`
  );
  if (subtaskIds.includes("task-")) {
    throw new Error("Decomposer subtask title must produce a non-empty task id");
  }
  if (subtaskIds.includes(args.taskId)) {
    throw new Error(`Decomposer subtask id collides with ${args.taskId}`);
  }
  if (new Set(subtaskIds).size !== subtaskIds.length) {
    throw new Error("Decomposer subtask titles produce duplicate task ids");
  }
  for (const [index, id] of subtaskIds.entries()) {
    const reuseTaskId = subtasks[index]!.reuseTaskId;
    const existing = showTask(args.workspaceRoot, id);
    if (reuseTaskId === null && existing.found) {
      throw new Error(`Decomposer subtask already exists: ${id}`);
    }
    if (reuseTaskId !== null) {
      if (!existing.found || existing.state === "dropped") {
        throw new Error(`Reusable decomposer subtask is unavailable: ${id}`);
      }
      const existingTitle = extractRepoTaskTitle(
        splitFrontMatter(existing.content)?.body ?? existing.content,
        id,
      );
      if (existingTitle !== subtasks[index]!.title) {
        throw new Error(
          `Reusable decomposer subtask ${id} has title "${existingTitle}", expected "${subtasks[index]!.title}"`,
        );
      }
    }
  }

  const changes = new Map<string, string>();
  const stage = (path: string, content: string) => changes.set(relative(args.workspaceRoot, path), content);
  const openDir = getRepoTaskContainerDir(args.workspaceRoot, "open");
  for (const [index, task] of subtasks.entries()) {
    const id = subtaskIds[index]!;
    const dependsOn = [
      ...(originalDependencies ?? []),
      ...[...new Set(task.dependsOn)].map(
        (dependencyIndex) => subtaskIds[dependencyIndex]!,
      ),
    ];
    if (task.reuseTaskId !== null) {
      const existing = showTask(args.workspaceRoot, id);
      if (!existing.found) throw new Error(`Reusable decomposer subtask is unavailable: ${id}`);
      if (existing.state === "open" || existing.state === "blocked") {
        const parsed = parseFlatFrontMatter(existing.content);
        const existingDependencies = parsed.attrs.depends_on;
        if (
          existingDependencies !== undefined &&
          !Array.isArray(existingDependencies)
        ) {
          throw new Error(`Reusable decomposer subtask ${id} has malformed depends_on metadata`);
        }
        const mergedDependencies = [...new Set([
          ...(existingDependencies ?? []),
          ...dependsOn,
        ])];
        const { depends_on: _ignoredDependencies, ...existingAttrs } = parsed.attrs;
        stage(
          join(getRepoTaskContainerDir(args.workspaceRoot, existing.state), `${id}.md`),
          serializeFlatFrontMatter(
            {
              ...existingAttrs,
              ...(mergedDependencies.length === 0
                ? {}
                : { depends_on: mergedDependencies }),
            },
            parsed.body,
          ),
        );
      }
      continue;
    }
    const attrs: Record<string, string | string[]> = {
      status: "open",
      priority: task.priority,
      ...(dependsOn.length > 0 ? { depends_on: dependsOn } : {}),
    };
    stage(
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

  // Dependents need all replacement outcomes, not a permanently dropped predecessor.
  for (const dependent of listFullRepoTasks(args.workspaceRoot, ["open", "blocked"])) {
    if (dependent.id === args.taskId || !dependent.dependsOn.includes(args.taskId)) continue;
    const path = join(getRepoTaskContainerDir(args.workspaceRoot, dependent.state), `${dependent.id}.md`);
    const existing = showTask(args.workspaceRoot, dependent.id);
    if (!existing.found) throw new Error(`Dependent task disappeared: ${dependent.id}`);
    const parsed = parseFlatFrontMatter(changes.get(relative(args.workspaceRoot, path)) ?? existing.content);
    const dependencies = parsed.attrs.depends_on as string[];
    stage(path, serializeFlatFrontMatter({
      ...parsed.attrs,
      depends_on: [...new Set(dependencies.flatMap((id) => id === args.taskId ? subtaskIds : [id]))],
    }, parsed.body));
  }
  const decomposedBody = `${originalBody.trim()}\n\n## Decomposed\n\n${subtaskIds.map((id) => `- ${id}`).join("\n")}`;
  stage(droppedPath, serializeFlatFrontMatter({ status: "dropped" }, decomposedBody));
  const originalPath = relative(args.workspaceRoot, join(getRepoTaskContainerDir(args.workspaceRoot, original.state), `${args.taskId}.md`));
  const conflict = [...changes.keys()].map((path) => basename(path, ".md"))
    .find((id) => args.heldTaskIds.includes(id));
  if (conflict) throw new Error(`Decomposition conflicts with held task:${conflict}`);

  // Validate the entire prospective queue before touching sandbox files. Runtime
  // integration rechecks ownership and publishes this changeset atomically.
  const current = readWorkingTextTree(args.workspaceRoot);
  const proposed: RepositoryTextTree = {
    read: (path) => changes.get(path) ?? current.read(path),
    list: (directory) => {
      const entries = new Map(current.list(directory)
        .filter((entry) => `${directory}/${entry.name}` !== originalPath)
        .map((entry) => [entry.name, entry]));
      for (const path of changes.keys()) {
        if (dirname(path) === directory) entries.set(basename(path), { name: basename(path), kind: "file" });
        else if (path.startsWith(`${directory}/`)) {
          const name = path.slice(directory.length + 1).split("/")[0]!;
          if (!entries.has(name)) entries.set(name, { name, kind: "directory" });
        }
      }
      return [...entries.values()];
    },
  };
  assertTaskQueueValid(args.workspaceRoot, proposed);
  for (const [path, content] of changes) {
    if (path !== relative(args.workspaceRoot, droppedPath)) writeRepoTaskFile(args.workspaceRoot, join(args.workspaceRoot, path), content);
  }
  const update = updateTaskBody(
    args.workspaceRoot,
    args.taskId,
    decomposedBody,
  );
  if (!update.ok) {
    throw new Error(`Could not annotate ${args.taskId} before decomposition: ${update.reason}`);
  }
  moveTaskById(args.workspaceRoot, args.taskId, "dropped");
  checkDecompositionApplied(args.workspaceRoot, args.taskId);
  return { taskId: args.taskId, subtaskIds };
}
