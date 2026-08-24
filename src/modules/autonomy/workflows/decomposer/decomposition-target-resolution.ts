import { parseFlatFrontMatter } from "#core/util/frontmatter.js";
import type { RepoTaskState } from "#modules/repo-tasks/repo-tasks-domain.js";
import {
  showTask,
  slugifyTaskTitle,
} from "#modules/repo-tasks/repo-tasks-operations.js";
import { readTaskDependencyIds } from "#modules/repo-tasks/task-dependencies.js";
import type { DecompositionPlan } from "./decomposition-plan.js";
import {
  sameTaskIds,
  uniqueTaskIds,
} from "./decomposition-task-reuse.js";

type DecompositionTarget = {
  id: string;
  task: DecompositionPlan["subtasks"][number];
} & (
  | { kind: "create" }
  | {
      kind: "reuse";
      content: string;
      state: Exclude<RepoTaskState, "done" | "dropped">;
    }
);

export type ResolvedDecompositionTarget = DecompositionTarget & {
  dependsOn: string[];
};

export function resolveDecompositionTargets(args: {
  originalDependencies: readonly string[];
  parentTaskId: string;
  projectDir: string;
  subtasks: DecompositionPlan["subtasks"];
}): ResolvedDecompositionTarget[] {
  const targets: DecompositionTarget[] = args.subtasks.map((task) => {
    const generatedId = `task-${slugifyTaskTitle(task.title)}`;
    if (task.reuseTaskId === null && generatedId === "task-") {
      throw new Error("Decomposer subtask title must produce a non-empty task id");
    }
    const id = task.reuseTaskId ?? generatedId;
    const existing = showTask(args.projectDir, id);
    if (task.reuseTaskId === null) {
      if (existing.found) {
        throw new Error(
          `Decomposer subtask already exists: ${id}; use reuseTaskId only when semantic review confirms equivalence`,
        );
      }
      return { kind: "create", id, task };
    }
    if (!existing.found || existing.state === "done" || existing.state === "dropped") {
      throw new Error(`Decomposer reuse target must be an open task: ${id}`);
    }
    return {
      kind: "reuse",
      id,
      task,
      content: existing.content,
      state: existing.state,
    };
  });
  const subtaskIds = targets.map((target) => target.id);
  if (subtaskIds.includes(args.parentTaskId)) {
    throw new Error(`Decomposer subtask id collides with ${args.parentTaskId}`);
  }
  if (new Set(subtaskIds).size !== subtaskIds.length) {
    throw new Error("Decomposer plan resolves multiple slices to the same task id");
  }

  return targets.map((target) => {
    const plannedDependencies = [...new Set(target.task.dependsOn)].map(
      (dependencyIndex) => subtaskIds[dependencyIndex]!,
    );
    const parsed = target.kind === "reuse"
      ? parseFlatFrontMatter(target.content)
      : null;
    if (parsed !== null && Object.keys(parsed.attrs).length === 0) {
      throw new Error(`Decomposer reuse target has malformed frontmatter: ${target.id}`);
    }
    const existingDependencies = parsed === null
      ? []
      : readTaskDependencyIds(parsed.attrs).filter(
        (dependencyId) => dependencyId !== args.parentTaskId,
      );
    const dependsOn = uniqueTaskIds([
      ...existingDependencies,
      ...args.originalDependencies,
      ...plannedDependencies,
    ]);
    if (dependsOn.includes(target.id)) {
      throw new Error(`Decomposer subtask ${target.id} cannot depend on itself`);
    }
    if (
      target.kind === "reuse" &&
      target.state === "doing" &&
      !sameTaskIds(readTaskDependencyIds(parsed!.attrs), dependsOn)
    ) {
      throw new Error(
        `Decomposer cannot change dependencies on active doing task ${target.id}`,
      );
    }
    return { ...target, dependsOn };
  });
}
